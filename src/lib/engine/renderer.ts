import { VERT, FRAG_ADJUST, FRAG_BLUR, FRAG_COMPOSITE } from "./shaders";
import {
  MAX_STRAIGHTEN_RAD,
  MAX_SELECTIVE_POINTS,
  MAX_HEALS,
  sourceToFrame,
  buildCurveLUT,
  expandFactor,
  TEXT_FAMILIES,
  framedSize,
  type LookParams,
} from "../looks";

/**
 * WebGL2 renderer for the Grainroom pipeline.
 *
 * Owns its canvas and three offscreen targets. Nothing here mutates the
 * source texture, so every render is a fresh evaluation of the recipe
 * against the original pixels — that is what "non-destructive" means in
 * practice, rather than a stack of baked intermediates.
 */
export class GrainroomRenderer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;

  private progAdjust: WebGLProgram;
  private progBlur: WebGLProgram;
  private progComposite: WebGLProgram;

  private vao: WebGLVertexArrayObject;
  private sourceTex: WebGLTexture | null = null;
  private curveTex: WebGLTexture;
  private textTex: WebGLTexture;
  /** What the text texture currently holds, so it is not redrawn every frame. */
  private textKey = "";
  private textCanvas: HTMLCanvasElement | null = null;

  private paintTex: WebGLTexture;
  private paintKey = "";
  private paintCanvas: HTMLCanvasElement | null = null;

  private targets: RenderTarget[] = [];
  private texFormat: { internal: number; type: number };

  private imageWidth = 0;
  private imageHeight = 0;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      // toBlob() reads the drawing buffer after the frame is done, so it
      // has to survive the compositor swap.
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error("WebGL2 is unavailable in this browser.");

    this.gl = gl;
    this.canvas = canvas;

    // Half-float targets keep the tone maths from banding in gradients.
    // Plain RGBA8 is the fallback and still looks fine on most photos.
    const hasFloat = gl.getExtension("EXT_color_buffer_float");
    this.texFormat = hasFloat
      ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT }
      : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };

    this.progAdjust = createProgram(gl, VERT, FRAG_ADJUST);
    this.progBlur = createProgram(gl, VERT, FRAG_BLUR);
    this.progComposite = createProgram(gl, VERT, FRAG_COMPOSITE);

    // One fullscreen triangle-strip quad, reused by every pass.
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("Could not allocate vertex array.");
    this.vao = vao;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.curveTex = createTexture(gl);
    this.textTex = createTexture(gl);
    this.paintTex = createTexture(gl);
    // One transparent pixel each, so the composite pass always has something
    // valid bound whether or not the photo carries a caption or any painting.
    for (const tex of [this.textTex, this.paintTex]) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0])
      );
    }
  }

  get width() {
    return this.imageWidth;
  }
  get height() {
    return this.imageHeight;
  }
  get isReady() {
    return this.sourceTex !== null;
  }

  setImage(source: TexImageSource, width: number, height: number) {
    const gl = this.gl;
    if (this.sourceTex) gl.deleteTexture(this.sourceTex);

    this.sourceTex = createTexture(gl);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    this.imageWidth = width;
    this.imageHeight = height;
  }

  /** Renders the recipe at the given output size. */
  render(params: LookParams, outWidth?: number, outHeight?: number) {
    const gl = this.gl;
    if (!this.sourceTex) return;

    const w = Math.max(1, Math.round(outWidth ?? this.canvas.width));
    const h = Math.max(1, Math.round(outHeight ?? this.canvas.height));

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    this.ensureTargets(w, h);
    const [texA, texB, texC] = this.targets;

    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, w, h);

    // --- pass 1: tone, colour, curves, HSL -> A ---
    this.uploadCurves(params);
    gl.bindFramebuffer(gl.FRAMEBUFFER, texA.fbo);
    gl.useProgram(this.progAdjust);
    this.bindTexture(this.progAdjust, "uImage", this.sourceTex, 0);
    this.bindTexture(this.progAdjust, "uCurves", this.curveTex, 1);
    this.setAdjustUniforms(params);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // --- passes 2 & 3: separable gaussian A -> B -> C ---
    // Radius scales with output size so the blur covers the same fraction
    // of the frame whether we are drawing a thumbnail or a full export.
    const radius = 1 + params.blurRadius * 14;
    gl.useProgram(this.progBlur);
    gl.uniform1f(gl.getUniformLocation(this.progBlur, "uRadius"), radius);

    gl.bindFramebuffer(gl.FRAMEBUFFER, texB.fbo);
    this.bindTexture(this.progBlur, "uImage", texA.tex, 0);
    gl.uniform2f(gl.getUniformLocation(this.progBlur, "uDirection"), 1 / w, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, texC.fbo);
    this.bindTexture(this.progBlur, "uImage", texB.tex, 0);
    gl.uniform2f(gl.getUniformLocation(this.progBlur, "uDirection"), 0, 1 / h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // --- pass 4: structure, glow, grain, vignette -> screen ---
    this.ensureText(params, w, h);
    this.ensurePaint(params, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.progComposite);
    this.bindTexture(this.progComposite, "uImage", texA.tex, 0);
    this.bindTexture(this.progComposite, "uBlur", texC.tex, 1);
    this.bindTexture(this.progComposite, "uText", this.textTex, 2);
    this.bindTexture(this.progComposite, "uPaint", this.paintTex, 3);
    this.setCompositeUniforms(params, w, h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindVertexArray(null);
  }

  /**
   * Pixel size of the finished frame, once crop and rotation are taken into
   * account. The canvas is fitted to this rather than to the source, so a
   * rotated portrait does not sit in a landscape box with bars either side.
   */
  outputSize(params: LookParams): { w: number; h: number } {
    return framedSize(params, this.imageWidth, this.imageHeight);
  }

  /**
   * Renders at the framed resolution and encodes it. The preview canvas is
   * restored afterwards by the next render() call.
   */
  async exportBlob(
    params: LookParams,
    opts: { type?: string; quality?: number; maxEdge?: number } = {}
  ): Promise<Blob> {
    const { type = "image/jpeg", quality = 0.95, maxEdge } = opts;

    let { w, h } = this.outputSize(params);
    if (maxEdge && Math.max(w, h) > maxEdge) {
      const s = maxEdge / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }

    this.render(params, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      this.canvas.toBlob(resolve, type, quality)
    );
    if (!blob) throw new Error("The browser refused to encode the export.");
    return blob;
  }

  dispose() {
    const gl = this.gl;
    this.targets.forEach((t) => {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    });
    this.targets = [];
    if (this.sourceTex) gl.deleteTexture(this.sourceTex);
    gl.deleteTexture(this.curveTex);
    gl.deleteTexture(this.textTex);
    gl.deleteTexture(this.paintTex);
    gl.deleteProgram(this.progAdjust);
    gl.deleteProgram(this.progBlur);
    gl.deleteProgram(this.progComposite);
  }

  /* -------------------------------------------------------------- */

  private ensureTargets(w: number, h: number) {
    const gl = this.gl;
    if (this.targets.length === 3 && this.targets[0].w === w && this.targets[0].h === h) {
      return;
    }
    this.targets.forEach((t) => {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    });
    this.targets = [0, 1, 2].map(() =>
      createTarget(gl, w, h, this.texFormat.internal, this.texFormat.type)
    );
  }

  private bindTexture(
    prog: WebGLProgram,
    name: string,
    tex: WebGLTexture | null,
    unit: number
  ) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(prog, name), unit);
  }

  /**
   * Renders the caption into a texture the size of the output.
   *
   * Type is drawn at the resolution it will be seen at, so the preview and a
   * full-resolution export are the same shapes rather than one being a scaled
   * copy of the other. The work is skipped whenever nothing that affects the
   * result has changed, which is almost every frame of a slider drag.
   */
  private ensureText(p: LookParams, w: number, h: number) {
    const gl = this.gl;
    const key = p.text.trim()
      ? [p.text, w, h, p.textX, p.textY, p.textSize, p.textTone, p.textFamily].join(
          "|"
        )
      : "";
    if (key === this.textKey) return;
    this.textKey = key;

    gl.bindTexture(gl.TEXTURE_2D, this.textTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    if (!key) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0])
      );
      return;
    }

    const canvas = this.textCanvas ?? document.createElement("canvas");
    this.textCanvas = canvas;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    const px = Math.max(6, p.textSize * h);
    ctx.font = `${px}px ${TEXT_FAMILIES[p.textFamily]}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const tone = Math.round(p.textTone * 255);
    ctx.fillStyle = `rgb(${tone}, ${tone}, ${tone})`;
    // A shadow the opposite way from the fill: white type over a bright sky
    // is unreadable otherwise, and this is cheaper than asking for an outline.
    ctx.shadowColor = p.textTone > 0.5 ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.4)";
    ctx.shadowBlur = px * 0.18;

    const lines = p.text.split("\n");
    const step = px * 1.25;
    const top = p.textY * h - ((lines.length - 1) * step) / 2;
    lines.forEach((line, i) => ctx.fillText(line, p.textX * w, top + i * step));

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  /**
   * Rasterises the brush marks into a mask at the output resolution.
   *
   * A canvas cannot accumulate a negative number, so each dab is drawn
   * additively with its strength in the alpha channel and its kind in the
   * colour: red dodges, green burns, blue saturates, and black desaturates.
   * Because the browser stores colour premultiplied, reading the texture back
   * unpremultiplied turns each channel into that kind's share of the total
   * strength — so multiplying a channel by alpha recovers exactly how much of
   * it was laid down, and the black share is whatever the colours do not
   * account for. The shader subtracts the pairs into signed adjustments.
   *
   * The stamps are positioned by running each mark through the same framing
   * maths the shader uses, so painted work stays where it was put when the
   * photo is later cropped or turned.
   */
  private ensurePaint(p: LookParams, w: number, h: number) {
    const gl = this.gl;
    const key = p.strokes.length
      ? `${w}x${h}|${p.quarterTurns}|${p.cropX},${p.cropY},${p.cropW},${p.cropH}` +
        `|${p.straighten}|${p.expand}|${p.flipH}${p.flipV}|${p.strokes.length}` +
        // The count plus both ends of the list: cheap to compare every frame,
        // and it cannot miss an edit that changed what is actually painted.
        `|${JSON.stringify(p.strokes[0])}|${JSON.stringify(p.strokes[p.strokes.length - 1])}`
      : "";
    if (key === this.paintKey) return;
    this.paintKey = key;

    gl.bindTexture(gl.TEXTURE_2D, this.paintTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    if (!key) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0])
      );
      return;
    }

    const canvas = this.paintCanvas ?? document.createElement("canvas");
    this.paintCanvas = canvas;
    // The mask is soft by nature, so half resolution costs nothing visible
    // and keeps a long session of painting off the critical path.
    canvas.width = Math.max(1, Math.round(w / 2));
    canvas.height = Math.max(1, Math.round(h / 2));

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "lighter";

    for (const s of p.strokes) {
      const at = sourceToFrame(p, s, this.imageWidth, this.imageHeight);
      const radius = (s.r / (p.cropH * expandFactor(p))) * canvas.height;
      if (radius < 0.5) continue;

      const x = at.x * canvas.width;
      const y = at.y * canvas.height;
      const strength = Math.min(Math.abs(s.amount), 1);
      const hue =
        s.mode === "light"
          ? s.amount > 0
            ? "255, 0, 0"
            : "0, 255, 0"
          : s.amount > 0
          ? "0, 0, 255"
          : "0, 0, 0";

      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
      grad.addColorStop(0, `rgba(${hue}, ${strength})`);
      // Falls to the same colour at zero alpha, not to transparent black, so
      // overlapping dabs of different kinds keep their shares separate.
      grad.addColorStop(1, `rgba(${hue}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  private uploadCurves(params: LookParams) {
    const gl = this.gl;
    const lut = buildCurveLUT(params);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      256,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      lut
    );
  }

  private setAdjustUniforms(p: LookParams) {
    const gl = this.gl;
    const prog = this.progAdjust;
    const u = (n: string) => gl.getUniformLocation(prog, n);

    gl.uniform4f(u("uTone"), p.exposure, p.contrast, p.highlights, p.shadows);
    gl.uniform4f(u("uTone2"), p.whites, p.blacks, p.fade, p.ambiance);
    gl.uniform4f(u("uColor"), p.saturation, p.vibrance, p.temperature, p.tint);
    gl.uniform4f(u("uSplit"), p.shadowHue, p.shadowSat, p.highlightHue, p.highlightSat);
    gl.uniform4f(u("uBW"), p.bwMix[0], p.bwMix[1], p.bwMix[2], p.bw ? 1 : 0);

    // Framing. The oriented size is the source with its axes swapped on an
    // odd number of quarter turns, which is what the crop rect is relative to.
    const turned = p.quarterTurns % 2 === 1;
    gl.uniform4f(u("uCrop"), p.cropX, p.cropY, p.cropW, p.cropH);
    gl.uniform2f(
      u("uOriented"),
      turned ? this.imageHeight : this.imageWidth,
      turned ? this.imageWidth : this.imageHeight
    );
    gl.uniform2f(u("uSource"), this.imageWidth, this.imageHeight);
    gl.uniform1f(u("uQuarter"), p.quarterTurns);
    gl.uniform1f(u("uAngle"), p.straighten * MAX_STRAIGHTEN_RAD);
    gl.uniform1f(u("uExpand"), expandFactor(p));
    gl.uniform2f(u("uFlip"), p.flipH ? -1 : 1, p.flipV ? -1 : 1);
    // Half a unit of keystone at full slider is about as far as the warp can
    // go before the stretched edge starts to read as damage rather than fix.
    gl.uniform2f(u("uKeystone"), p.perspectiveH * 0.5, p.perspectiveV * 0.5);

    // Selective points. The arrays are always uploaded at full length so a
    // removed point cannot leave a stale entry behind the count.
    const count = Math.min(p.points.length, MAX_SELECTIVE_POINTS);
    const a = new Float32Array(MAX_SELECTIVE_POINTS * 4);
    const b = new Float32Array(MAX_SELECTIVE_POINTS * 4);
    for (let i = 0; i < count; i++) {
      const pt = p.points[i];
      a.set([pt.x, pt.y, pt.size, 0], i * 4);
      b.set([pt.brightness, pt.contrast, pt.saturation, 0], i * 4);
    }
    gl.uniform1i(u("uPointCount"), count);
    gl.uniform4fv(u("uPointA"), a);
    gl.uniform4fv(u("uPointB"), b);

    const heals = Math.min(p.heals.length, MAX_HEALS);
    const h = new Float32Array(MAX_HEALS * 4);
    for (let i = 0; i < heals; i++) {
      h.set([p.heals[i].x, p.heals[i].y, p.heals[i].r, 0], i * 4);
    }
    gl.uniform1i(u("uHealCount"), heals);
    gl.uniform4fv(u("uHeal"), h);

    gl.uniform1fv(u("uHueShift"), new Float32Array(p.hueShift));
    gl.uniform1fv(u("uSatShift"), new Float32Array(p.satShift));
    gl.uniform1fv(u("uLumShift"), new Float32Array(p.lumShift));
  }

  private setCompositeUniforms(p: LookParams, w: number, h: number) {
    const gl = this.gl;
    const prog = this.progComposite;
    const u = (n: string) => gl.getUniformLocation(prog, n);

    gl.uniform4f(u("uFx"), p.structure, p.sharpen, p.grain, p.vignette);
    gl.uniform4f(u("uFx2"), p.bloom, p.halation, p.dehaze, p.lensBlur);
    gl.uniform2f(u("uResolution"), w, h);
    gl.uniform1f(u("uSeed"), p.grainSeed);
    gl.uniform1f(u("uVignetteFalloff"), p.vignetteFalloff);
    gl.uniform2f(u("uBorder"), p.borderWidth, p.borderTone);
    gl.uniform3f(u("uPortrait"), p.skinSmooth, p.faceSpotlight, p.eyeClarity);
    gl.uniform1f(u("uTextOpacity"), p.text.trim() ? p.textOpacity : 0);
    gl.uniform1f(u("uPaintOn"), p.strokes.length ? 1 : 0);
  }
}

/* ------------------------------------------------------------------ */

interface RenderTarget {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error("Could not allocate texture.");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

function createTarget(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  internal: number,
  type: number
): RenderTarget {
  const tex = createTexture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);

  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error("Could not allocate framebuffer.");
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete (0x${status.toString(16)}).`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { tex, fbo, w, h };
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  src: string
): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("Could not allocate shader.");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader failed to compile: ${log}`);
  }
  return sh;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string
): WebGLProgram {
  const prog = gl.createProgram();
  if (!prog) throw new Error("Could not allocate program.");
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "aPos");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    throw new Error(`Program failed to link: ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

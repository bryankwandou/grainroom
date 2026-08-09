//! Look Registry
//!
//! A Look is an edit recipe — a few hundred bytes of slider positions and
//! curve control points that reproduce the same image from the same source
//! on any machine. Because it is deterministic it can be addressed by the
//! hash of its own contents, and that is the only thing this program stores.
//!
//! No photograph touches the chain. What the chain is for is the part that
//! ordinary file sharing cannot do: remembering who wrote a grade, and
//! paying every author in the lineage when a descendant of their work earns
//! something. A preset sold as a file is indistinguishable from a copied
//! one. A Look carries its parent, so the trail survives every fork.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("14a2jErBjHQv7fD64F6P1nLt6LXCsKgiyoi1c4mkyfaE");

/// Ceiling on a single author's cut, in basis points. Ten percent.
/// A chain of greedy ancestors could otherwise consume the whole payment
/// before it reaches the person who actually did the most recent work.
const MAX_ROYALTY_BPS: u16 = 1_000;

/// How far back the program will walk when splitting a payment. Deep chains
/// still register fine; only the payout walk is bounded, because each hop
/// costs an account slot in the transaction.
const MAX_LINEAGE_DEPTH: usize = 8;

const MAX_NAME_LEN: usize = 48;

#[program]
pub mod look_registry {
    use super::*;

    /// Records authorship of a Look.
    ///
    /// `look_hash` is the SHA-256 of the canonical parameter serialisation
    /// produced by the client. The program does not recompute it — it cannot,
    /// since it never sees the parameters — so this is a claim of authorship
    /// anchored in time, not a proof that the hash matches any given recipe.
    /// What it does guarantee is that the first claim wins: the hash is the
    /// PDA seed, so a second registration of identical settings fails.
    pub fn register_look(
        ctx: Context<RegisterLook>,
        look_hash: [u8; 32],
        name: String,
        royalty_bps: u16,
    ) -> Result<()> {
        require!(name.len() <= MAX_NAME_LEN, RegistryError::NameTooLong);
        require!(!name.is_empty(), RegistryError::NameEmpty);
        require!(
            royalty_bps <= MAX_ROYALTY_BPS,
            RegistryError::RoyaltyTooHigh
        );

        let record = &mut ctx.accounts.look;
        record.author = ctx.accounts.author.key();
        record.look_hash = look_hash;
        record.name = name;
        record.royalty_bps = royalty_bps;
        record.created_at = Clock::get()?.unix_timestamp;
        record.derivative_count = 0;
        record.total_earned = 0;
        record.bump = ctx.bumps.look;

        // A root Look points at itself, which keeps the payout walk from
        // needing a null case and makes depth measurable from any node.
        record.parent = None;
        record.depth = 0;

        emit!(LookRegistered {
            look: record.key(),
            author: record.author,
            look_hash,
            parent: None,
            depth: 0,
        });

        Ok(())
    }

    /// Records a Look that was derived from an existing one.
    ///
    /// The parent must already be registered. Its derivative counter is
    /// bumped here rather than being recomputed later, so the number is
    /// readable without indexing every account in the program.
    pub fn register_derivative(
        ctx: Context<RegisterDerivative>,
        look_hash: [u8; 32],
        name: String,
        royalty_bps: u16,
    ) -> Result<()> {
        require!(name.len() <= MAX_NAME_LEN, RegistryError::NameTooLong);
        require!(!name.is_empty(), RegistryError::NameEmpty);
        require!(
            royalty_bps <= MAX_ROYALTY_BPS,
            RegistryError::RoyaltyTooHigh
        );

        let parent_key = ctx.accounts.parent.key();
        let parent_depth = ctx.accounts.parent.depth;

        require!(
            (parent_depth as usize) < MAX_LINEAGE_DEPTH,
            RegistryError::LineageTooDeep
        );

        let record = &mut ctx.accounts.look;
        record.author = ctx.accounts.author.key();
        record.look_hash = look_hash;
        record.name = name;
        record.royalty_bps = royalty_bps;
        record.created_at = Clock::get()?.unix_timestamp;
        record.derivative_count = 0;
        record.total_earned = 0;
        record.bump = ctx.bumps.look;
        record.parent = Some(parent_key);
        record.depth = parent_depth
            .checked_add(1)
            .ok_or(RegistryError::LineageTooDeep)?;

        let parent = &mut ctx.accounts.parent;
        parent.derivative_count = parent.derivative_count.saturating_add(1);

        emit!(LookRegistered {
            look: record.key(),
            author: record.author,
            look_hash,
            parent: Some(parent_key),
            depth: record.depth,
        });

        Ok(())
    }

    /// Pays for a Look and settles the lineage in the same transaction.
    ///
    /// The caller supplies the ancestor chain as remaining accounts, ordered
    /// nearest parent first. The program verifies the chain rather than
    /// trusting it: each account must be the one its child names as parent.
    /// A caller who omits an ancestor to keep the money cannot, because the
    /// link check fails and the whole transfer reverts.
    ///
    /// Each ancestor takes its own `royalty_bps` of the gross. Whatever is
    /// left goes to the author of the Look actually being bought.
    // The explicit `'info` is required rather than stylistic: `remaining_accounts`
    // hands back `AccountInfo<'info>` values that are then fed into a CPI
    // alongside `ctx.accounts`, and Anchor's context lifetimes are invariant.
    // Without tying both to the same parameter the borrow checker cannot prove
    // the two sets outlive each other.
    pub fn purchase<'info>(
        ctx: Context<'_, '_, 'info, 'info, Purchase<'info>>,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, RegistryError::AmountZero);

        let look = &ctx.accounts.look;
        let ancestors = ctx.remaining_accounts;

        require!(
            ancestors.len() <= MAX_LINEAGE_DEPTH,
            RegistryError::LineageTooDeep
        );

        let mut distributed: u64 = 0;
        // Start the walk at the Look being purchased and step upward.
        let mut expected_parent: Option<Pubkey> = look.parent;

        for account in ancestors.iter() {
            // The chain must be unbroken and in order.
            let expected = expected_parent.ok_or(RegistryError::LineageOverrun)?;
            require_keys_eq!(account.key(), expected, RegistryError::LineageMismatch);

            let ancestor: Account<LookRecord> = Account::try_from(account)?;

            let cut = (amount as u128)
                .checked_mul(ancestor.royalty_bps as u128)
                .ok_or(RegistryError::MathOverflow)?
                .checked_div(10_000)
                .ok_or(RegistryError::MathOverflow)? as u64;

            distributed = distributed
                .checked_add(cut)
                .ok_or(RegistryError::MathOverflow)?;
            require!(distributed < amount, RegistryError::RoyaltiesExceedPayment);

            if cut > 0 {
                // Lamports move to the ancestor's own record account, which
                // its author can sweep. Paying the author key directly would
                // need every author as a writable account on the transaction.
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.buyer.to_account_info(),
                            to: account.clone(),
                        },
                    ),
                    cut,
                )?;
            }

            expected_parent = ancestor.parent;
        }

        // Anything not claimed by an ancestor belongs to the seller.
        let remainder = amount
            .checked_sub(distributed)
            .ok_or(RegistryError::MathOverflow)?;

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.seller.to_account_info(),
                },
            ),
            remainder,
        )?;

        let look = &mut ctx.accounts.look;
        look.total_earned = look.total_earned.saturating_add(remainder);

        emit!(LookPurchased {
            look: look.key(),
            buyer: ctx.accounts.buyer.key(),
            amount,
            to_lineage: distributed,
            to_seller: remainder,
        });

        Ok(())
    }

    /// Moves accumulated royalties out of a Look record and to its author.
    ///
    /// Rent-exempt lamports stay behind, otherwise the account would be
    /// swept out of existence along with the authorship record it holds.
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let look_info = ctx.accounts.look.to_account_info();
        let rent_floor = Rent::get()?.minimum_balance(look_info.data_len());

        let balance = look_info.lamports();
        let claimable = balance.saturating_sub(rent_floor);
        require!(claimable > 0, RegistryError::NothingToWithdraw);

        // Direct lamport arithmetic: a CPI transfer will not work here
        // because the source account is owned by this program, not System.
        **look_info.try_borrow_mut_lamports()? = balance
            .checked_sub(claimable)
            .ok_or(RegistryError::MathOverflow)?;

        let author_info = ctx.accounts.author.to_account_info();
        **author_info.try_borrow_mut_lamports()? = author_info
            .lamports()
            .checked_add(claimable)
            .ok_or(RegistryError::MathOverflow)?;

        emit!(RoyaltiesWithdrawn {
            look: ctx.accounts.look.key(),
            author: ctx.accounts.author.key(),
            amount: claimable,
        });

        Ok(())
    }
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

#[account]
pub struct LookRecord {
    pub author: Pubkey,
    pub look_hash: [u8; 32],
    /// The Look this was derived from. `None` marks an original.
    pub parent: Option<Pubkey>,
    /// Hops back to the root. Bounded so payout walks stay affordable.
    pub depth: u8,
    pub royalty_bps: u16,
    pub derivative_count: u64,
    pub total_earned: u64,
    pub created_at: i64,
    pub bump: u8,
    pub name: String,
}

impl LookRecord {
    // discriminator + author + hash + Option<Pubkey> + depth + bps
    // + derivative_count + total_earned + created_at + bump + name
    pub const SPACE: usize =
        8 + 32 + 32 + (1 + 32) + 1 + 2 + 8 + 8 + 8 + 1 + (4 + MAX_NAME_LEN);
}

#[derive(Accounts)]
#[instruction(look_hash: [u8; 32])]
pub struct RegisterLook<'info> {
    #[account(
        init,
        payer = author,
        space = LookRecord::SPACE,
        seeds = [b"look", look_hash.as_ref()],
        bump
    )]
    pub look: Account<'info, LookRecord>,

    #[account(mut)]
    pub author: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(look_hash: [u8; 32])]
pub struct RegisterDerivative<'info> {
    #[account(
        init,
        payer = author,
        space = LookRecord::SPACE,
        seeds = [b"look", look_hash.as_ref()],
        bump
    )]
    pub look: Account<'info, LookRecord>,

    #[account(
        mut,
        seeds = [b"look", parent.look_hash.as_ref()],
        bump = parent.bump
    )]
    pub parent: Account<'info, LookRecord>,

    #[account(mut)]
    pub author: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Purchase<'info> {
    #[account(
        mut,
        seeds = [b"look", look.look_hash.as_ref()],
        bump = look.bump,
        has_one = author @ RegistryError::SellerNotAuthor
    )]
    pub look: Account<'info, LookRecord>,

    /// CHECK: verified by the `has_one` constraint on `look`.
    pub author: UncheckedAccount<'info>,

    /// Must be the author of the Look being bought.
    #[account(mut, address = look.author @ RegistryError::SellerNotAuthor)]
    pub seller: SystemAccount<'info>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"look", look.look_hash.as_ref()],
        bump = look.bump,
        has_one = author @ RegistryError::NotTheAuthor
    )]
    pub look: Account<'info, LookRecord>,

    #[account(mut)]
    pub author: Signer<'info>,
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

#[event]
pub struct LookRegistered {
    pub look: Pubkey,
    pub author: Pubkey,
    pub look_hash: [u8; 32],
    pub parent: Option<Pubkey>,
    pub depth: u8,
}

#[event]
pub struct LookPurchased {
    pub look: Pubkey,
    pub buyer: Pubkey,
    pub amount: u64,
    pub to_lineage: u64,
    pub to_seller: u64,
}

#[event]
pub struct RoyaltiesWithdrawn {
    pub look: Pubkey,
    pub author: Pubkey,
    pub amount: u64,
}

/* ------------------------------------------------------------------ */

#[error_code]
pub enum RegistryError {
    #[msg("Look name exceeds the 48 character limit.")]
    NameTooLong,
    #[msg("Look name cannot be empty.")]
    NameEmpty,
    #[msg("Royalty cannot exceed 10 percent.")]
    RoyaltyTooHigh,
    #[msg("Payment amount must be greater than zero.")]
    AmountZero,
    #[msg("Lineage is deeper than the registry will settle in one transaction.")]
    LineageTooDeep,
    #[msg("An ancestor account does not match the parent its child names.")]
    LineageMismatch,
    #[msg("More ancestor accounts were supplied than the lineage contains.")]
    LineageOverrun,
    #[msg("Royalties would consume the entire payment.")]
    RoyaltiesExceedPayment,
    #[msg("The seller account is not the author of this Look.")]
    SellerNotAuthor,
    #[msg("Only the author may withdraw from this Look.")]
    NotTheAuthor,
    #[msg("Nothing above the rent floor is available to withdraw.")]
    NothingToWithdraw,
    #[msg("Arithmetic overflow.")]
    MathOverflow,
}

/**
 * Handova contract ABIs and addresses.
 * Update ESCROW_ADDRESS and NFT_ADDRESS after deploy.
 */

export const ESCROW_ADDRESS = (import.meta.env.VITE_ESCROW_ADDRESS ?? '') as `0x${string}`;
export const NFT_ADDRESS = (import.meta.env.VITE_NFT_ADDRESS ?? '') as `0x${string}`;

export const ESCROW_ABI = [
  // Read
  {
    inputs: [{ name: 'listingId', type: 'uint256' }],
    name: 'listings',
    outputs: [
      { name: 'landlord', type: 'address' },
      { name: 'rentAmountUsdc', type: 'uint256' },
      { name: 'depositAmountUsdc', type: 'uint256' },
      { name: 'active', type: 'bool' },
      { name: 'metadataUri', type: 'string' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    name: 'escrows',
    outputs: [
      { name: 'listingId', type: 'uint256' },
      { name: 'tenant', type: 'address' },
      { name: 'totalHeld', type: 'uint256' },
      { name: 'status', type: 'uint8' },
      { name: 'createdAt', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  { inputs: [], name: 'listingCounter', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'escrowCounter', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'addr', type: 'address' }], name: 'pendingWithdrawals', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'escrowId', type: 'uint256' }], name: 'movedInAt', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'listingId', type: 'uint256' }], name: 'listingToEscrowId', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'escrowId', type: 'uint256' }], name: 'handoverAt', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'escrowId', type: 'uint256' }], name: 'endRequestedAt', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'escrowId', type: 'uint256' }], name: 'disputedAt', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'arbiter', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: '', type: 'address' }], name: 'verifiedAt', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  // Write
  {
    inputs: [
      { name: 'rentAmountUsdc', type: 'uint256' },
      { name: 'depositAmountUsdc', type: 'uint256' },
      { name: 'metadataUri', type: 'string' },
    ],
    name: 'createListing',
    outputs: [{ name: 'listingId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'listingId', type: 'uint256' }],
    name: 'depositRent',
    outputs: [{ name: 'escrowId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    name: 'confirmMoveIn',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    name: 'endTenancy',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'withdraw',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'listingId', type: 'uint256' }],
    name: 'deactivateListing',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    name: 'markHandover',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    name: 'claimMoveIn',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    name: 'approveDepositReturn',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    name: 'claimDeposit',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    name: 'dispute',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'escrowId', type: 'uint256' }, { name: 'landlordShareBps', type: 'uint8' }],
    name: 'resolveDispute',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'listingId', type: 'uint256' },
      { indexed: true, name: 'landlord', type: 'address' },
      { indexed: false, name: 'rentAmountUsdc', type: 'uint256' },
      { indexed: false, name: 'depositAmountUsdc', type: 'uint256' },
    ],
    name: 'ListingCreated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'escrowId', type: 'uint256' },
      { indexed: true, name: 'listingId', type: 'uint256' },
      { indexed: true, name: 'tenant', type: 'address' },
    ],
    name: 'RentDeposited',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [{ indexed: true, name: 'escrowId', type: 'uint256' }],
    name: 'MoveInConfirmed',
    type: 'event',
  },
] as const;

export const ERC20_APPROVE_ABI = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/** EscrowStatus enum matching Solidity */
export enum EscrowStatus {
  Pending = 0,
  Active = 1,
  Released = 2,
  Refunded = 3,
  Disputed = 4,
  Ending = 5,
}

export const ESCROW_STATUS_LABEL: Record<EscrowStatus, string> = {
  [EscrowStatus.Pending]: 'Awaiting Move-in',
  [EscrowStatus.Active]: 'Active',
  [EscrowStatus.Released]: 'Completed',
  [EscrowStatus.Refunded]: 'Refunded',
  [EscrowStatus.Disputed]: 'In Dispute',
  [EscrowStatus.Ending]: 'Caution Fee Review',
};

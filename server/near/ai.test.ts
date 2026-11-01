import { expect, test } from 'bun:test';
import { recoverSigner } from './ai';

test('recovers the NEAR AI TEE signer from a real receipt', () => {
  // Real receipt from NEAR AI Cloud, z-ai/glm-5.3-flash, 2026-11-01.
  const text = 'z-ai/glm-5.3-flash:8f7d40bbf860883145189be365ad065f8a8c754397f042fdb35903dcedf73ede:e8e25f931886123b242ed0e24ee307f58358ca5be9f86c848668bc93fa520f6d';
  const signature = '0x76ddd3b6195c9a76dc5b6a6c672b3937485ad0a92ac41ae88aa90d261a417adf71574ab2b7c34cdaa31a20d27b33f03e496bd57d818b80ffed92dcfa780a218f1c';
  expect(recoverSigner(text, signature)).toBe('0x3b753b4406613c5e70ae640508632b600424fa0c');
  expect(recoverSigner(text + 'x', signature)).not.toBe('0x3b753b4406613c5e70ae640508632b600424fa0c');
});

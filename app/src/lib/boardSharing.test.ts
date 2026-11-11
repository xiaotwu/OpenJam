import { describe, expect, it } from 'vitest';
import { boardCredentialFragment, readBoardCredential } from './boardSharing';

describe('sharing credential links', () => {
  const token = 'a'.repeat(43);

  it('keeps the invitation token in the fragment while redirecting through sign-in', () => {
    const credential = readBoardCredential(`#invite=${token}`);
    expect(credential).toEqual({ kind: 'invite', token });
    const signIn = new URL(`/auth?mode=login&next=%2Fboard%2Fexample${boardCredentialFragment(credential!)}`, 'https://example.test');
    expect(signIn.searchParams.get('next')).toBe('/board/example');
    expect(signIn.search).not.toContain(token);
    expect(readBoardCredential(signIn.hash)).toEqual(credential);
  });

  it('rejects incomplete or ambiguous fragments without interpreting them as credentials', () => {
    expect(readBoardCredential('#page=ideas')).toBeNull();
    expect(readBoardCredential('#share=bad')).toEqual({ kind: 'share', token: '' });
    expect(readBoardCredential(`#invite=${token}&share=${token}`)).toEqual({ kind: 'invite', token: '' });
    expect(readBoardCredential(`#share=${token}&share=${token}`)).toEqual({ kind: 'share', token: '' });
  });
});

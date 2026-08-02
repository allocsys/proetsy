import { describe, it, expect, vi } from 'vitest';

// The third of ARCHITECTURE.md's three documented swappable provider-layer interfaces
// (lib/llm/, lib/trends/, lib/tags/) — the only one of the three with no test of its own
// until now. Unlike llm/index.js and trends/index.js, this one has no env-var-driven
// branching yet (user-list.js is the only v1 implementation — auto-suggest.js is
// documented as future/not built), so there's no provider-selection logic to exercise;
// this just locks in that it's a faithful pass-through to user-list.js, so a future
// provider-switch addition here (mirroring the other two) has a baseline to diff against.
vi.mock('./user-list.js', () => ({
  getTagCandidates: vi.fn(async (imageAnalysis) => [`tag-for-${imageAnalysis?.subject ?? 'unknown'}`]),
}));

describe('getTagCandidates', () => {
  it('delegates straight through to user-list.js (the only v1 implementation)', async () => {
    const { getTagCandidates } = await import('./index.js');
    const userList = await import('./user-list.js');

    const imageAnalysis = { subject: 'a mountain landscape' };
    const result = await getTagCandidates(imageAnalysis);

    expect(userList.getTagCandidates).toHaveBeenCalledWith(imageAnalysis);
    expect(result).toEqual(['tag-for-a mountain landscape']);
  });
});

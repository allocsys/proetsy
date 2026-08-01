import * as userList from './user-list.js';

// user-list is the only v1 implementation; auto-suggest.js (future) would plug in here
// behind the same getTagCandidates(imageAnalysis) interface.
export async function getTagCandidates(imageAnalysis) {
  return userList.getTagCandidates(imageAnalysis);
}

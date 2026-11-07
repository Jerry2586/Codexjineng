// Capability labels describe relevance; they never prove execution or review.
export function inferDomains(goal = '', stack = [], needs = []) {
  const result = new Set();
  const add = (domain, matches) => { if (matches) result.add(domain); };
  for (const need of needs) if (['backend','database','api','security','environment','deployment','writing','product','architecture'].includes(need)) result.add(need);
  add('web-ui', needs.includes('frontend') || /frontend|front.end|网页|前端|界面|\bui\b/i.test(goal));
  add('web-animation', /animation|motion|hover|spring|动效|动画|缓动/i.test(goal));
  add('mobile-web', /mobile web|\bpwa\b|移动网页|手机网页|触摸|safe.area|安全区域/i.test(goal));
  add('react-native', stack.some(s => ['expo','react-native'].includes(s)) || /react.native|\bexpo\b/i.test(goal));
  add('swift', stack.includes('swift') || /\bswift\b/i.test(goal));
  add('backend', stack.some(s => ['python','go','java','rust','php','csharp'].includes(s)) || /backend|server|后端|服务端/i.test(goal));
  add('database', /database|\bsql\b|数据库|迁移/i.test(goal));
  add('api', /\bapi\b|接口|契约/i.test(goal));
  add('prototyping', /prototype|原型/i.test(goal));
  add('toasts', /sonner|toast|提示消息|通知提示/i.test(goal));
  add('code-review', /code.review|代码审查|代码审核/i.test(goal));
  add('refactoring', /refactor|重构/i.test(goal));
  if (!result.size && needs.includes('testing')) result.add('general-testing');
  return [...result].sort();
}
export const PROFILE_FIELDS = ['needs','domains','excludeDomains','stacks','phases','tools','operations','access','inputs','outputs','explicitOnly','conflicts','notFor','declaration','review'];
export function profileReviewed(profile, skill) {
  const review = profile?.review;
  return Boolean(review && review.sha256 === skill.sha256 && review.version === skill.version && review.source && review.reviewer && review.artifact);
}

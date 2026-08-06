/**
 * When to stop scrolling a search.
 *
 * The previous criterion counted collected cards, so a page full of vacancies
 * that would never be sent still looked like progress. All the reasons here are
 * about yield or cost:
 *
 *  - the results crossed the freshness horizon (valid only because the search is
 *    sorted newest-first, so everything below is older still);
 *  - the last few scrolls produced no *qualified* job;
 *  - the run spent its time budget, which is the scarce resource.
 *
 * @param {object} state   { qualifiedCount, staleScrolls, oldestPostedAt, elapsedMs, scrolls }
 * @param {object} limits  { staleScrollLimit, budgetMs, maxScrolls, freshnessDays, now }
 * @returns {{stop: boolean, reason: string}}
 */
export function shouldStopScrolling(state, limits) {
  const now = limits?.now instanceof Date ? limits.now : new Date();

  if (state.elapsedMs >= limits.budgetMs) return { stop: true, reason: "run_budget" };
  if (state.scrolls >= limits.maxScrolls) return { stop: true, reason: "max_scrolls" };

  if (state.oldestPostedAt) {
    const ageDays = (now.getTime() - new Date(state.oldestPostedAt).getTime()) / 86400000;
    if (ageDays > limits.freshnessDays) return { stop: true, reason: "freshness_horizon" };
  }

  if (state.staleScrolls >= limits.staleScrollLimit) return { stop: true, reason: "no_qualified_yield" };

  return { stop: false, reason: "" };
}

/* Idle Island configuration. Classic script. */
(function () {
  'use strict';
  window.II = window.II || {};
  window.II.config = {
    // Public App Key (pk_...) registered for this page's address. Safe to commit.
    APP_KEY: 'pk_LQ8Z4CYp2vJS6RVr',
    REPO_URL: 'https://github.com/patbing/idle-island',
    PAPER_URL: 'https://arxiv.org/abs/2610.07130',
    API: 'https://gen.pollinations.ai',
    // Free (not paid-only), cheap, healthy text models offered first.
    DEFAULT_MODELS: ['openai/gpt-6-luna', 'openai/gpt-oss-20b', 'openai/gpt-5-nano'],
    MAX_TOKENS: 4000,
    TIMEOUT_MS: 60000,
    // A live experiment stops itself before spending more than this.
    MAX_SPEND: 0.15,
    PARALLEL_TESTS: 4,
    // Rough per-call cost: the pilots measured ~1,400 input tokens and about 250 output tokens (GPT-6 Luna, gpt-oss-20b).
    EST_IN_TOKENS: 1500,
    EST_OUT_TOKENS: 400
  };
})();

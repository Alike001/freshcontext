# Offline demo evidence

This folder contains network-independent backup evidence generated from the production FreshContext
container and its pinned HydraDB OSS runtime.

- `screenshots/overview.png` shows the 10-second product story and verified HydraDB state.
- `screenshots/proof-console.png` shows the exact cross-file HydraDB impact path and Git diff.
- `screenshots/review-complete.png` shows the immutable supersession result.
- `screenshots/evaluation.png` shows the checked public-source trace, MCP recall and abstention
  receipt, score comparison, and visible four-hop false negative.
- `screenshots/setup.png` shows the actual local service and repository state.
- `video/evaluation-proof.webm` records the production flow from Overview through the Proof Console,
  review result, Evaluation, and Setup. It is a technical backup, not the final narrated
  three-minute submission video.

Start the production stack, then regenerate every asset with:

```bash
pnpm demo:capture
```

The capture fails if HydraDB health, the live Proof Console, the verified evaluation reference, or
Setup state is unavailable. It never replaces a failed live route with static HTML or invented
metrics. On a fresh graph it completes the example review through the real API. On a previously
reviewed graph it records the already verified supersession.

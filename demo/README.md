# Offline demo evidence

This folder contains network-independent backup evidence generated from the production FreshContext
container and its pinned HydraDB OSS runtime.

- `screenshots/overview.png` shows the 10-second product story and verified HydraDB state.
- `screenshots/evaluation.png` shows the complete checked evaluation reference, including its
  visible four-hop false negative.
- `screenshots/setup.png` shows the actual local service and repository state.
- `video/evaluation-proof.webm` records the production flow from Overview through Evaluation and
  Setup. It is a technical backup, not the final narrated three-minute submission video.

Start the production stack, then regenerate every asset with:

```bash
pnpm demo:capture
```

The capture fails if HydraDB health, the verified evaluation reference, or Setup state is
unavailable. It never replaces a failed live route with static HTML or invented metrics.

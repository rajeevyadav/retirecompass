# Privacy

RetireCompass is built so that privacy is not a policy you have to trust — it is
enforced by the code.

- **Nothing is transmitted.** The app makes no network request of any kind. A
  Content-Security-Policy in `index.html` sets `connect-src 'none'`, which blocks
  every fetch, socket and remote connection at the browser level. A release test
  (`tests/test_no_network.py`) fails the build if any network call or remote URL
  is ever added.
- **No account and no server.** There is no login, no backend, and no database.
  The numbers you type stay in your browser session on your own device.
- **No tracking.** No analytics, no ad network, no third-party scripts, no
  cookies used for tracking.
- **You own your data.** Anything you keep is a file you choose to save (for
  example a printed PDF). Deleting it removes it.

The desktop launcher only serves the bundled files from `127.0.0.1` on your own
machine; it never reaches the internet.

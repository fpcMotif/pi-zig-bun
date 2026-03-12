🎯 **What:** The vulnerability fixed
Exposed stdout error info from search bridge containing sensitive paths (binary path and workspace root).

⚠️ **Risk:** The potential impact if left unfixed
If the binary path output contains sensitive information, it will be written to the log file or returned in RPC errors, leaking internal server information.

🛡️ **Solution:** How the fix addresses the vulnerability
Applied the existing `this.scrub()` method to the error message created when an RPC returns an error. This scrubs the sensitive paths (binary path and workspace root) from the stdout error log and RPC response, replacing them with `[BINARY_PATH]` and `[WORKSPACE_ROOT]`.

// The inherited IPC channel closes if the supervisor is killed or replaced.
"use strict";
process.once("disconnect", () => process.exit(0));
require(process.argv[2]);

// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
await rm(dist, { recursive: true, force: true });

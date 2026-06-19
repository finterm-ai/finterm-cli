/**
 * `finterm dataroom` - Inspect and query downloaded research datarooms.
 *
 * The command tree lives in the standalone `@finterm/dataroom-cli` package so it can be
 * reused outside this CLI; this module only adopts it under the `finterm` program.
 */

import { buildDataroomCommand } from '@finterm/dataroom-cli';

export const dataroomCommand = buildDataroomCommand();

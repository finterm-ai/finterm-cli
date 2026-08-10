import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  APIResponse,
  BundleArtifactsData,
  BundleRunData,
  FintermAPIClient,
  SyncManifestData,
  SyncManifestFile,
} from '../../lib/api-client.js';
import { createAPIClient } from '../../lib/api-client.js';
import { CLIError } from './errors.js';
import { downloadBundleRunArtifacts, getAgentRunStatus } from './bundle-runs.js';

const RUN_ID = 'run_test_path_safety';
const SIGNED_URL = 'https://example.invalid/signed/object';

/**
 * Minimal stand-in for the API client that returns a single succeeded run plus a
 * caller-supplied sync manifest. Only the surface `downloadBundleRunArtifacts`
 * exercises is implemented.
 */
function makeClient(manifestFiles: SyncManifestFile[]): FintermAPIClient {
  const run: BundleRunData = {
    runId: RUN_ID,
    bundleName: 'test_bundle',
    descriptorId: 'descriptor_1',
    lifecycle: 'runtime_http',
    status: 'succeeded',
    normalizedRequest: { ticker: 'TEST', deliveryMode: 'dataroom_sync' },
    manifestReady: true,
    links: {
      self: `/api/v1/runs/${RUN_ID}`,
      result: `/api/v1/runs/${RUN_ID}/result`,
      artifacts: `/api/v1/runs/${RUN_ID}/artifacts`,
      syncManifest: `/api/v1/runs/${RUN_ID}/sync-manifest`,
    },
  };

  const artifacts: BundleArtifactsData = {
    runId: RUN_ID,
    bundleName: 'test_bundle',
    descriptorId: 'descriptor_1',
    lifecycle: 'runtime_http',
    status: 'succeeded',
    manifestReady: true,
    artifacts: [],
  };

  const manifest: SyncManifestData = {
    runId: RUN_ID,
    roomFormat: 'DR/0.3',
    roomProfile: 'file',
    files: manifestFiles,
  };

  const client = {
    baseUrl: 'https://api.example.invalid',
    bundleStatus(): Promise<APIResponse<BundleRunData>> {
      return Promise.resolve({ success: true, data: run });
    },
    bundleArtifacts(): Promise<APIResponse<BundleArtifactsData>> {
      return Promise.resolve({ success: true, data: artifacts });
    },
    bundleSyncManifest(): Promise<APIResponse<SyncManifestData>> {
      return Promise.resolve({ success: true, data: manifest });
    },
  };

  return client as unknown as FintermAPIClient;
}

function manifestFile(relativePath: string, content: string): SyncManifestFile {
  return {
    path: relativePath,
    bytes: Buffer.byteLength(content),
    sha256: createHash('sha256').update(Buffer.from(content)).digest('hex'),
    url: SIGNED_URL,
    expiresAt: '2999-01-01T00:00:00.000Z',
  };
}

describe('downloadBundleRunArtifacts path safety guard', () => {
  let tempHome: string;
  let roomPath: string;
  let previousConfig: string | undefined;

  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(tmpdir(), 'finterm-ledger-'));
    roomPath = await mkdtemp(path.join(tmpdir(), 'finterm-room-'));
    previousConfig = process.env.FINTERM_CONFIG;
    // Redirect the run ledger away from the real ~/.finterm so the test is hermetic.
    process.env.FINTERM_CONFIG = tempHome;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (previousConfig === undefined) {
      delete process.env.FINTERM_CONFIG;
    } else {
      process.env.FINTERM_CONFIG = previousConfig;
    }
    await rm(tempHome, { recursive: true, force: true });
    await rm(roomPath, { recursive: true, force: true });
  });

  const unsafePaths: { name: string; value: string }[] = [
    { name: 'parent traversal', value: '../escape.txt' },
    { name: 'nested traversal', value: 'sub/../../escape.txt' },
    { name: 'absolute posix path', value: '/etc/passwd' },
    { name: 'backslash path', value: 'sub\\file.txt' },
    { name: 'reserved .finterm prefix', value: '.finterm/sync-state.json' },
    { name: 'reserved .finterm exact', value: '.finterm' },
  ];

  for (const { name, value } of unsafePaths) {
    it(`rejects an unsafe manifest path (${name})`, async () => {
      const client = makeClient([manifestFile(value, 'payload')]);
      await expect(
        downloadBundleRunArtifacts(client, RUN_ID, { mode: 'merge', room: roomPath })
      ).rejects.toBeInstanceOf(CLIError);
      // The guard rejects before materializing any file into the room.
      const entries = await readdir(roomPath);
      expect(entries).toEqual([]);
    });
  }

  /**
   * Built from the API's real snake_case payloads rather than the camelCase the
   * client happens to read. The earlier fixtures were written camelCase, which
   * meant the suite agreed with the reader instead of with the server and kept
   * these mismatches invisible.
   */
  it('derives artifact ids and next action from a live snake_case payload', async () => {
    const runId = 'run_live_shape';
    const wireRun = {
      run_id: runId,
      bundle_name: 'test_bundle',
      descriptor_id: 'descriptor_1',
      lifecycle: 'runtime_http',
      status: 'succeeded',
      normalized_request: { ticker: 'TEST', delivery_mode: 'dataroom_sync' },
      manifest_ready: false,
      links: {
        self: `/api/v1/runs/${runId}`,
        result: `/api/v1/runs/${runId}/result`,
        artifacts: `/api/v1/runs/${runId}/artifacts`,
        sync_manifest: `/api/v1/runs/${runId}/sync-manifest`,
      },
    };
    const wireArtifacts = {
      run_id: runId,
      bundle_name: 'test_bundle',
      descriptor_id: 'descriptor_1',
      lifecycle: 'runtime_http',
      status: 'succeeded',
      manifest_ready: false,
      artifacts: [
        {
          artifact_id: 'artifact_live_1',
          run_id: runId,
          artifact_type: 'dataroom',
          download_url: SIGNED_URL,
          checksum_sha256: 'abc123',
        },
      ],
    };

    // Drive the real client so the response normalizers run, rather than stubbing
    // the client and testing the readers against a shape they never receive.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        const body = String(url).includes('/artifacts') ? wireArtifacts : wireRun;
        return new Response(JSON.stringify({ success: true, data: body }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      })
    );
    const client = createAPIClient('https://api.example.invalid', 'fint_auth_test', {
      cacheEnabled: false,
    });

    const status = await getAgentRunStatus(client, runId);

    // Previously always [] because the reader looked for `artifactId`.
    expect(status.artifactIds).toEqual(['artifact_live_1']);
    // delivery_mode was invisible, so an unpublished manifest never became "wait".
    expect(status.syncManifest).toBe('not_ready');
    expect(status.nextAction).toBe('wait');
  });

  it('accepts a normal nested relative path and materializes it under the room', async () => {
    const content = 'finterm-test-content\n';
    const client = makeClient([manifestFile('reports/summary.md', content)]);

    const fetcher = (): Promise<Response> =>
      Promise.resolve(new Response(content, { status: 200 }));

    const result = await downloadBundleRunArtifacts(client, RUN_ID, {
      mode: 'merge',
      room: roomPath,
      fetcher,
    });

    expect(result.files).toHaveLength(1);
    // The accepted path is returned in normalized POSIX form.
    expect(result.files[0]?.path).toBe('reports/summary.md');
    expect(result.downloadedCount).toBe(1);
  });
});

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { verifyCiConfiguration } from './verify-ci-workflow.mjs'

const workflowUrl = new URL('../.github/workflows/ci.yml', import.meta.url)
const dependabotUrl = new URL('../.github/dependabot.yml', import.meta.url)
const workerPackageUrl = new URL('../apps/worker/package.json', import.meta.url)

async function committedConfiguration() {
  return {
    workflow: await readFile(workflowUrl, 'utf8'),
    dependabot: await readFile(dependabotUrl, 'utf8')
  }
}

function mutateWorkflow(workflow, mutation) {
  const configuration = parse(workflow)
  mutation(configuration)
  return stringify(configuration)
}

describe('CI release workflow contract', () => {
  it('accepts the committed release workflow and dependency update policy', async () => {
    await expect(committedConfiguration().then(verifyCiConfiguration)).resolves.toBeUndefined()
  })

  it('rejects mutable action references', async () => {
    const configuration = await committedConfiguration()
    const workflow = configuration.workflow.replace(
      /actions\/checkout@[0-9a-f]{40}/,
      'actions/checkout@v7'
    )

    expect(() => verifyCiConfiguration({ ...configuration, workflow })).toThrow(
      'all GitHub Actions must use immutable commit SHAs'
    )
  })

  it('rejects removal of the exact npm version assertion', async () => {
    const configuration = await committedConfiguration()
    const workflow = configuration.workflow.replace(
      'test "$(corepack npm --version)" = "11.18.0"',
      'printf "npm version not checked\\n"'
    )

    expect(() => verifyCiConfiguration({ ...configuration, workflow })).toThrow(
      'CI must verify the declared npm version'
    )
  })

  it('rejects a commented-out database test step', async () => {
    const configuration = await committedConfiguration()
    const workflow = configuration.workflow.replace(
      'run: corepack npm run test:ci',
      'run: |\n          # corepack npm run test:ci'
    )

    expect(() => verifyCiConfiguration({ ...configuration, workflow })).toThrow(
      'CI must run the full database test suite'
    )
  })

  it('rejects a downgraded E2E PostgreSQL service', async () => {
    const configuration = await committedConfiguration()
    const workflow = configuration.workflow.replace(
      /(e2e:\n[\s\S]*?image:\s*)postgres:16-alpine/,
      '$1postgres:15-alpine'
    )

    expect(() => verifyCiConfiguration({ ...configuration, workflow })).toThrow(
      'E2E must use the pinned PostgreSQL 16 service'
    )
  })

  it.each([
    ['CodeQL', 'codeql', 'CI must define the codeql job'],
    ['production image builds', 'images', 'CI must define the images job'],
    ['dependency review', 'dependency-review', 'CI must define the dependency-review job']
  ])('rejects removal of %s', async (_contract, jobName, message) => {
    const configuration = await committedConfiguration()
    const workflow = mutateWorkflow(configuration.workflow, parsed => {
      delete parsed.jobs[jobName]
    })

    expect(() => verifyCiConfiguration({ ...configuration, workflow })).toThrow(message)
  })

  it('rejects CodeQL without scoped SARIF upload permission', async () => {
    const configuration = await committedConfiguration()
    const workflow = configuration.workflow.replace('security-events: write', 'security-events: read')

    expect(() => verifyCiConfiguration({ ...configuration, workflow })).toThrow(
      'CodeQL must have scoped security-events write permission'
    )
  })

  it('rejects a different immutable SHA for CodeQL initialization', async () => {
    const configuration = await committedConfiguration()
    const workflow = configuration.workflow.replace(
      'github/codeql-action/init@db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28',
      `github/codeql-action/init@${'0'.repeat(40)}`
    )

    expect(() => verifyCiConfiguration({ ...configuration, workflow })).toThrow(
      'CodeQL must initialize JavaScript and TypeScript analysis with the pinned action'
    )
  })

  it('rejects CodeQL without explicit buildless analysis', async () => {
    const configuration = await committedConfiguration()
    const workflow = configuration.workflow.replace('build-mode: none', 'build-mode: manual')

    expect(() => verifyCiConfiguration({ ...configuration, workflow })).toThrow(
      'CodeQL must use buildless JavaScript and TypeScript analysis'
    )
  })

  it('rejects CodeQL without linked analysis tools', async () => {
    const configuration = await committedConfiguration()
    const workflow = configuration.workflow.replace('tools: linked', 'tools: latest')

    expect(() => verifyCiConfiguration({ ...configuration, workflow })).toThrow(
      'CodeQL must use linked analysis tools'
    )
  })

  it('rejects dependency review outside pull requests or below the full runtime policy', async () => {
    const configuration = await committedConfiguration()
    const notPullRequestOnly = configuration.workflow.replace(
      "if: github.event_name == 'pull_request'",
      'if: always()'
    )
    const highSeverityOnly = configuration.workflow.replace('fail-on-severity: low', 'fail-on-severity: high')

    expect(() => verifyCiConfiguration({ ...configuration, workflow: notPullRequestOnly })).toThrow(
      'dependency review must run only on pull requests'
    )
    expect(() => verifyCiConfiguration({ ...configuration, workflow: highSeverityOnly })).toThrow(
      'dependency review must fail on low-severity runtime findings without comments'
    )
  })

  it('rejects image builds without runtime metadata assertions', async () => {
    const configuration = await committedConfiguration()
    const workflow = configuration.workflow.replace(
      "test \"$(docker image inspect --format '{{.Config.User}}' webreg-web:ci)\" = node",
      'printf "web runtime user not checked\\n"'
    )

    expect(() => verifyCiConfiguration({ ...configuration, workflow })).toThrow(
      'image build job must verify exact runtime users, health checks, and commands'
    )
  })

  it.each(['worker', 'migrate'])('rejects %s image health checks based on object truthiness', async image => {
    const configuration = await committedConfiguration()
    const workflow = configuration.workflow.replace(
      `test "$(docker image inspect --format '{{json .Config.Healthcheck.Test}}' webreg-${image}:ci)" = '["NONE"]'`,
      `test "$(docker image inspect --format '{{if .Config.Healthcheck}}configured{{else}}none{{end}}' webreg-${image}:ci)" = none`
    )

    expect(() => verifyCiConfiguration({ ...configuration, workflow })).toThrow(
      'image build job must verify exact runtime users, health checks, and commands'
    )
  })

  it.each([
    ['web', '["node","apps/web/server.js"]'],
    ['worker', '["node","apps/worker/dist/index.js"]'],
    ['migrate', '["node","scripts/migrate-production.mjs"]']
  ])('rejects the %s image without its exact container command', async (image, command) => {
    const configuration = await committedConfiguration()
    const workflow = configuration.workflow.replace(
      `test "$(docker image inspect --format '{{json .Config.Cmd}}' webreg-${image}:ci)" = '${command}'`,
      `printf "${image} command not checked\\n"`
    )

    expect(() => verifyCiConfiguration({ ...configuration, workflow })).toThrow(
      'image build job must verify exact runtime users, health checks, and commands'
    )
  })

  it.each([
    ["+'/api/live'", "+'/api/ready'"],
    [".Config.Healthcheck.Interval}}' webreg-web:ci)\" = 30000000000", ".Config.Healthcheck.Interval}}' webreg-web:ci)\" = 31000000000"],
    [".Config.Healthcheck.Timeout}}' webreg-web:ci)\" = 3000000000", ".Config.Healthcheck.Timeout}}' webreg-web:ci)\" = 4000000000"],
    [".Config.Healthcheck.StartPeriod}}' webreg-web:ci)\" = 15000000000", ".Config.Healthcheck.StartPeriod}}' webreg-web:ci)\" = 16000000000"],
    [".Config.Healthcheck.Retries}}' webreg-web:ci)\" = 3", ".Config.Healthcheck.Retries}}' webreg-web:ci)\" = 4"]
  ])('rejects altered web image health metadata: %s', async (present, replacement) => {
    const configuration = await committedConfiguration()
    const workflow = configuration.workflow.replace(present, replacement)

    expect(() => verifyCiConfiguration({ ...configuration, workflow })).toThrow(
      'image build job must verify exact runtime users, health checks, and commands'
    )
  })

  it('rejects an image job that omits the migration image', async () => {
    const configuration = await committedConfiguration()
    const workflow = configuration.workflow.replace(
      'docker build --file Dockerfile.migrate --tag webreg-migrate:ci .',
      'printf "migration image not built\\n"'
    )

    expect(() => verifyCiConfiguration({ ...configuration, workflow })).toThrow(
      'image build job must build all production images sequentially without pushing'
    )
  })

  it.each([
    ['the exact package manager', 'corepack npm ci', 'npm ci'],
    ['the Node 22/24 matrix', '[22, 24]', '[24]'],
    ['PostgreSQL 16', 'postgres:16-alpine', 'postgres:15-alpine'],
    ['Redis 7', 'redis:7-alpine', 'redis:6-alpine'],
    ['the isolated E2E database', 'webreg_e2e', 'webreg_ci'],
    [
      'the strict production-build database URL',
      'postgresql://build:build@db.invalid/build?sslmode=require&sslaccept=strict',
      'postgresql://build:build@db.invalid/build'
    ],
    ['history-free tree materialization', 'git archive --format=tar HEAD', 'cp -R . /tmp/scan'],
    ['current-tree secret scanning', '--no-git', '--log-opts=--all'],
    ['failure-only browser artifacts', 'if: failure()', 'if: always()']
  ])('rejects removal of %s', async (_contract, present, replacement) => {
    const configuration = await committedConfiguration()
    const workflow = configuration.workflow.replaceAll(present, replacement)

    expect(() => verifyCiConfiguration({ ...configuration, workflow })).toThrow()
  })

  it('rejects mutable or incomplete Dependabot policy', async () => {
    const configuration = await committedConfiguration()
    const dependabot = configuration.dependabot.replace('version: 2', 'version: 1')

    expect(() => verifyCiConfiguration({ ...configuration, dependabot })).toThrow(
      'Dependabot must use version 2'
    )
  })

  it('enters the worker build through the declared npm version', async () => {
    const workerPackage = JSON.parse(await readFile(workerPackageUrl, 'utf8'))

    expect(workerPackage.scripts.build).toMatch(/^corepack npm run generate --workspace @webreg\/db/)
  })
})

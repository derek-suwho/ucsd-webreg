import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'

const POSTGRES_IMAGE = 'postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685'
const REDIS_IMAGE = 'redis:7-alpine@sha256:ee9e8748ace004102a267f7b8265dab2c618317df22507b89d16a8add7154273'
const BUILD_DATABASE_URL = 'postgresql://build:build@db.invalid/build?sslmode=require&sslaccept=strict'
const CODEQL_ACTION = 'github/codeql-action'
const CODEQL_SHA = 'db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28'
const DEPENDENCY_REVIEW_ACTION = 'actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294'
const IMAGE_BUILD_COMMAND = `set -euo pipefail
docker build --file Dockerfile.web --tag webreg-web:ci .
docker build --file Dockerfile.worker --tag webreg-worker:ci .
docker build --file Dockerfile.migrate --tag webreg-migrate:ci .`
const IMAGE_METADATA_COMMAND = `set -euo pipefail
test "$(docker image inspect --format '{{.Config.User}}' webreg-web:ci)" = node
test "$(docker image inspect --format '{{.Config.User}}' webreg-worker:ci)" = node
test "$(docker image inspect --format '{{.Config.User}}' webreg-migrate:ci)" = node
test "$(docker image inspect --format '{{len .Config.Healthcheck.Test}}' webreg-web:ci)" = 4
test "$(docker image inspect --format '{{index .Config.Healthcheck.Test 0}}' webreg-web:ci)" = CMD
test "$(docker image inspect --format '{{index .Config.Healthcheck.Test 1}}' webreg-web:ci)" = node
test "$(docker image inspect --format '{{index .Config.Healthcheck.Test 2}}' webreg-web:ci)" = -e
test "$(docker image inspect --format '{{index .Config.Healthcheck.Test 3}}' webreg-web:ci)" = "fetch('http://127.0.0.1:'+(process.env.PORT||'3000')+'/api/live',{signal:AbortSignal.timeout(2000)}).then(response=>{if(!response.ok)throw new Error()}).catch(()=>process.exit(1))"
test "$(docker image inspect --format '{{json .Config.Healthcheck.Interval}}' webreg-web:ci)" = 30000000000
test "$(docker image inspect --format '{{json .Config.Healthcheck.Timeout}}' webreg-web:ci)" = 3000000000
test "$(docker image inspect --format '{{json .Config.Healthcheck.StartPeriod}}' webreg-web:ci)" = 15000000000
test "$(docker image inspect --format '{{json .Config.Healthcheck.Retries}}' webreg-web:ci)" = 3
test "$(docker image inspect --format '{{json .Config.Healthcheck.Test}}' webreg-worker:ci)" = '["NONE"]'
test "$(docker image inspect --format '{{json .Config.Healthcheck.Test}}' webreg-migrate:ci)" = '["NONE"]'
test "$(docker image inspect --format '{{json .Config.Cmd}}' webreg-web:ci)" = '["node","apps/web/server.js"]'
test "$(docker image inspect --format '{{json .Config.Cmd}}' webreg-worker:ci)" = '["node","apps/worker/dist/index.js"]'
test "$(docker image inspect --format '{{json .Config.Cmd}}' webreg-migrate:ci)" = '["node","scripts/migrate-production.mjs"]'`

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function asRecord(value, message) {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), message)
  return value
}

function asArray(value, message) {
  requireCondition(Array.isArray(value), message)
  return value
}

function parseConfiguration(source, message) {
  try {
    return asRecord(parse(source), message)
  } catch (error) {
    if (error instanceof Error && error.message === message) throw error
    throw new Error(message)
  }
}

function job(jobs, name) {
  return asRecord(jobs[name], `CI must define the ${name} job`)
}

function steps(releaseJob) {
  return asArray(releaseJob.steps, 'CI jobs must define steps').map(value => asRecord(value, 'CI steps must be objects'))
}

function namedStep(releaseJob, name) {
  const releaseStep = steps(releaseJob).find(candidate => candidate.name === name)
  return asRecord(releaseStep, `CI must define the ${name} step`)
}

function requireExactRun(releaseJob, name, command, message) {
  requireCondition(namedStep(releaseJob, name).run?.trim() === command, message)
}

function requireRunner(releaseJob) {
  requireCondition(releaseJob['runs-on'] === 'ubuntu-24.04', 'CI jobs must use the pinned Ubuntu 24.04 runner')
  requireCondition(Number.isInteger(releaseJob['timeout-minutes']) && releaseJob['timeout-minutes'] > 0, 'CI jobs must have timeouts')
}

function requireService(releaseJob, name, image, message, healthCheck) {
  const services = asRecord(releaseJob.services, message)
  const service = asRecord(services[name], message)
  requireCondition(service.image === image, message)
  requireCondition(typeof service.options === 'string' && service.options.includes(healthCheck), `${name} service must have a health check`)
  return service
}

function requirePinnedActions(jobs) {
  let actionCount = 0
  for (const releaseJob of Object.values(jobs).map(value => asRecord(value, 'CI jobs must be objects'))) {
    for (const releaseStep of steps(releaseJob)) {
      if (typeof releaseStep.uses !== 'string') continue
      actionCount += 1
      requireCondition(
        releaseStep.uses.startsWith('./') || /@[0-9a-f]{40}$/.test(releaseStep.uses),
        'all GitHub Actions must use immutable commit SHAs'
      )
      if (releaseStep.uses.startsWith('actions/checkout@')) {
        const checkoutOptions = asRecord(releaseStep.with, 'checkout must disable credential persistence')
        requireCondition(checkoutOptions['persist-credentials'] === false, 'checkout must disable credential persistence')
      }
    }
  }
  requireCondition(actionCount > 0, 'all GitHub Actions must use immutable commit SHAs')
}

function requireActivationStep(releaseJob) {
  const run = namedStep(releaseJob, 'Activate declared npm').run
  requireCondition(typeof run === 'string' && run.split(/\r?\n/).map(line => line.trim()).includes(
    'test "$(corepack npm --version)" = "11.18.0"'
  ), 'CI must verify the declared npm version')
}

export function verifyCiConfiguration({ workflow, dependabot }) {
  const workflowConfig = parseConfiguration(workflow, 'CI workflow must be valid YAML')
  const jobs = asRecord(workflowConfig.jobs, 'CI workflow must define jobs')
  const quality = job(jobs, 'quality')
  const codeql = job(jobs, 'codeql')
  const dependencyReview = job(jobs, 'dependency-review')
  const images = job(jobs, 'images')
  const e2e = job(jobs, 'e2e')
  const supplyChain = job(jobs, 'supply-chain')

  const permissions = asRecord(workflowConfig.permissions, 'workflow permissions must be read-only')
  requireCondition(permissions.contents === 'read', 'workflow permissions must be read-only')
  requireCondition(!Object.values(permissions).includes('write'), 'workflow permissions must not grant write access')
  const concurrency = asRecord(workflowConfig.concurrency, 'workflow must cancel superseded runs')
  requireCondition(concurrency['cancel-in-progress'] === true, 'workflow must cancel superseded runs')
  requireCondition(
    typeof concurrency.group === 'string' && concurrency.group.includes('github.workflow') && concurrency.group.includes('github.ref'),
    'workflow concurrency must be branch-scoped'
  )

  for (const releaseJob of [quality, codeql, dependencyReview, images, e2e, supplyChain]) requireRunner(releaseJob)
  requirePinnedActions(jobs)

  const qualityStrategy = asRecord(quality.strategy, 'CI must test Node 22 and 24')
  const qualityMatrix = asRecord(qualityStrategy.matrix, 'CI must test Node 22 and 24')
  requireCondition(
    JSON.stringify(qualityMatrix['node-version']) === JSON.stringify([22, 24]),
    'CI must test Node 22 and 24'
  )
  requireService(quality, 'postgres', POSTGRES_IMAGE, 'CI must use the pinned PostgreSQL 16 service', 'pg_isready')
  requireService(quality, 'redis', REDIS_IMAGE, 'CI must use the pinned Redis 7 service', 'redis-cli ping')
  requireActivationStep(quality)
  requireExactRun(quality, 'Install dependencies', 'corepack npm ci', 'CI must use the declared package manager for a clean install')
  requireExactRun(quality, 'Generate Prisma Client', 'corepack npm run generate --workspace @webreg/db', 'CI must generate Prisma Client')
  requireExactRun(quality, 'Apply migrations', 'corepack npm exec -- prisma migrate deploy --schema packages/db/prisma/schema.prisma', 'CI must deploy migrations')
  requireExactRun(quality, 'Verify service connections', 'corepack npm run verify:ci-services', 'CI must verify PostgreSQL and Redis')
  requireExactRun(quality, 'Verify CI contract', 'corepack npm run verify:ci-workflow', 'CI must verify its release contract')
  requireExactRun(quality, 'Seed demo catalog', 'corepack npm run seed:demo', 'CI must seed the demo catalog')
  requireExactRun(quality, 'Run full database test suite', 'corepack npm run test:ci', 'CI must run the full database test suite')
  requireExactRun(quality, 'Run clean TypeScript build', 'corepack npm run typecheck:clean', 'CI must run a clean TypeScript build')
  requireExactRun(quality, 'Lint without warnings', 'corepack npm run lint:ci', 'CI lint must reject warnings')
  requireExactRun(quality, 'Build web application', 'corepack npm run build:web', 'CI must build the web app')
  requireExactRun(quality, 'Build worker', 'corepack npm run build:worker', 'CI must build the worker')
  const webBuildEnv = asRecord(namedStep(quality, 'Build web application').env, 'production web builds must validate a nonconnecting strict-TLS PostgreSQL URL')
  requireCondition(webBuildEnv.DATABASE_URL === BUILD_DATABASE_URL, 'production web builds must validate a nonconnecting strict-TLS PostgreSQL URL')

  const codeqlPermissions = asRecord(codeql.permissions, 'CodeQL must have scoped security-events write permission')
  requireCondition(
    JSON.stringify(Object.keys(codeqlPermissions).sort()) === JSON.stringify(['contents', 'security-events']) &&
      codeqlPermissions.contents === 'read' && codeqlPermissions['security-events'] === 'write',
    'CodeQL must have scoped security-events write permission'
  )
  requireCondition(codeql['timeout-minutes'] === 20, 'CodeQL must have a bounded 20-minute timeout')
  const codeqlInit = namedStep(codeql, 'Initialize CodeQL')
  const codeqlInitOptions = asRecord(codeqlInit.with, 'CodeQL must initialize JavaScript and TypeScript analysis with the pinned action')
  requireCondition(
    codeqlInit.uses === `${CODEQL_ACTION}/init@${CODEQL_SHA}` && codeqlInitOptions.languages === 'javascript-typescript',
    'CodeQL must initialize JavaScript and TypeScript analysis with the pinned action'
  )
  requireCondition(codeqlInitOptions['build-mode'] === 'none', 'CodeQL must use buildless JavaScript and TypeScript analysis')
  requireCondition(codeqlInitOptions.tools === 'linked', 'CodeQL must use linked analysis tools')
  requireCondition(
    namedStep(codeql, 'Analyze JavaScript and TypeScript').uses === `${CODEQL_ACTION}/analyze@${CODEQL_SHA}`,
    'CodeQL must analyze with the pinned action'
  )

  requireCondition(dependencyReview.if === "github.event_name == 'pull_request'", 'dependency review must run only on pull requests')
  const dependencyReviewPermissions = asRecord(dependencyReview.permissions, 'dependency review must have contents read permission only')
  requireCondition(
    JSON.stringify(dependencyReviewPermissions) === JSON.stringify({ contents: 'read' }),
    'dependency review must have contents read permission only'
  )
  const dependencyReviewStep = namedStep(dependencyReview, 'Review dependency changes')
  const dependencyReviewOptions = asRecord(dependencyReviewStep.with, 'dependency review must fail on low-severity runtime findings without comments')
  requireCondition(dependencyReviewStep.uses === DEPENDENCY_REVIEW_ACTION, 'dependency review must use the pinned official action')
  requireCondition(
    dependencyReviewOptions['fail-on-severity'] === 'low' &&
      dependencyReviewOptions['fail-on-scopes'] === 'runtime' &&
      dependencyReviewOptions['comment-summary-in-pr'] === 'never',
    'dependency review must fail on low-severity runtime findings without comments'
  )

  const imagePermissions = asRecord(images.permissions, 'image build job must have contents read permission only')
  requireCondition(JSON.stringify(imagePermissions) === JSON.stringify({ contents: 'read' }), 'image build job must have contents read permission only')
  requireCondition(images['timeout-minutes'] === 35, 'image build job must have a bounded 35-minute timeout')
  const imageEnv = asRecord(images.env, 'image build job must enable BuildKit')
  requireCondition(imageEnv.DOCKER_BUILDKIT === '1', 'image build job must enable BuildKit')
  requireExactRun(images, 'Build production images', IMAGE_BUILD_COMMAND, 'image build job must build all production images sequentially without pushing')
  requireExactRun(images, 'Verify image runtime metadata', IMAGE_METADATA_COMMAND, 'image build job must verify exact runtime users, health checks, and commands')

  const e2ePostgres = requireService(e2e, 'postgres', POSTGRES_IMAGE, 'E2E must use the pinned PostgreSQL 16 service', 'pg_isready')
  const e2ePostgresEnv = asRecord(e2ePostgres.env, 'E2E must use a dedicated *_e2e database')
  const e2eEnv = asRecord(e2e.env, 'E2E must use a dedicated *_e2e database')
  requireCondition(e2ePostgresEnv.POSTGRES_DB === 'webreg_e2e' && /\/webreg_e2e$/.test(e2eEnv.TEST_DATABASE_URL), 'E2E must use a dedicated *_e2e database')
  requireCondition(namedStep(e2e, 'Set up Node 24').with?.['node-version'] === 24, 'E2E must run on Node 24')
  requireActivationStep(e2e)
  requireExactRun(e2e, 'Install dependencies', 'corepack npm ci', 'CI must use the declared package manager for a clean install')
  requireExactRun(e2e, 'Generate Prisma Client', 'corepack npm run generate --workspace @webreg/db', 'CI must generate Prisma Client')
  requireExactRun(e2e, 'Install Chromium', 'corepack npm exec --workspace @webreg/web -- playwright install --with-deps chromium', 'E2E must install Chromium and system dependencies')
  requireExactRun(e2e, 'Run browser tests', 'corepack npm run e2e --workspace @webreg/web', 'CI must run browser E2E tests')
  const artifact = namedStep(e2e, 'Upload browser failure evidence')
  requireCondition(artifact.if === 'failure()', 'browser artifacts must upload only after failure')
  const artifactWith = asRecord(artifact.with, 'browser artifact paths must be narrowly scoped')
  const artifactPaths = typeof artifactWith.path === 'string' ? artifactWith.path.split(/\r?\n/).map(path => path.trim()).filter(Boolean) : []
  requireCondition(
    JSON.stringify(artifactPaths) === JSON.stringify(['apps/web/test-results/', 'apps/web/playwright-report/']),
    'browser artifact paths must be narrowly scoped'
  )

  requireActivationStep(supplyChain)
  requireExactRun(supplyChain, 'Audit production dependencies', 'corepack npm audit --omit=dev', 'CI must audit production dependencies')
  const secretScan = namedStep(supplyChain, 'Scan current tree for secrets')
  const secretScanEnv = asRecord(secretScan.env, 'CI must install a pinned Gitleaks release')
  requireCondition(secretScanEnv.GITLEAKS_VERSION === '8.30.1', 'CI must install a pinned Gitleaks release')
  requireCondition(typeof secretScanEnv.GITLEAKS_SHA256 === 'string' && /^[0-9a-f]{64}$/.test(secretScanEnv.GITLEAKS_SHA256), 'CI must verify the Gitleaks archive checksum')
  requireCondition(typeof secretScan.run === 'string' && secretScan.run.includes('gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz'), 'CI must use the pinned Gitleaks archive')
  requireCondition(secretScan.run.includes('sha256sum --check'), 'CI must verify the Gitleaks archive checksum')
  requireCondition(secretScan.run.includes('git archive --format=tar HEAD'), 'Gitleaks must scan a history-free current-tree archive')
  requireCondition(secretScan.run.includes('--no-git'), 'Gitleaks must scan the current tree without history')
  requireCondition(secretScan.run.includes('--redact'), 'Gitleaks output must redact secrets')

  const dependabotConfig = parseConfiguration(dependabot, 'Dependabot configuration must be valid YAML')
  requireCondition(dependabotConfig.version === 2, 'Dependabot must use version 2')
  const updates = asArray(dependabotConfig.updates, 'Dependabot must define updates')
  for (const ecosystem of ['npm', 'github-actions']) {
    const update = updates.map(value => asRecord(value, 'Dependabot updates must be objects')).find(candidate => candidate['package-ecosystem'] === ecosystem)
    requireCondition(update !== undefined, `Dependabot must update ${ecosystem === 'npm' ? 'npm dependencies' : 'GitHub Actions'}`)
    requireCondition(asRecord(update.schedule, 'Dependabot updates must run weekly').interval === 'weekly', 'Dependabot updates must run weekly')
  }
}

async function main() {
  const workflowPath = resolve(process.argv[2] ?? '.github/workflows/ci.yml')
  const dependabotPath = resolve(process.argv[3] ?? '.github/dependabot.yml')
  verifyCiConfiguration({
    workflow: await readFile(workflowPath, 'utf8'),
    dependabot: await readFile(dependabotPath, 'utf8')
  })
  process.stdout.write('CI configuration contract verified\n')
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (entryUrl === import.meta.url) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'CI configuration verification failed'}\n`)
    process.exitCode = 1
  })
}

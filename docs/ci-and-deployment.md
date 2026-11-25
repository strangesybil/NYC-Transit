# CI checks and AWS deployment

`.github/workflows/deploy.yml` runs the **Tests** job on pushes to every branch, on pull requests targeting `main`, and on manual workflow runs. Pushes and pull requests may both run checks for a branch with an open PR; the PR run tests GitHub's proposed merge commit.

## Checks

The Ubuntu runner uses Python 3.12 and Node.js 22. It installs `requirements-test.txt` (production requirements plus cryptography for signed-token tests) and runs `npm ci` using the committed lockfile. It checks Django configuration and missing migrations, applies migrations to the runner's SQLite database, runs backend/frontend tests, and verifies static collection. Tests use mocked feed/authentication requests and throwaway keys; they do not require Google accounts or AWS credentials.

The **Deploy to AWS** job requires Tests to succeed and only runs for a push to `main`. A failed check skips deployment. Pull requests, feature branches and manual runs do not deploy. The existing AWS application, environment, region and GitHub secret names remain unchanged. The deployment package is created with `git archive`, excluding generated databases, node_modules and collected static files. Elastic Beanstalk runs its own migrations and static collection.

## Require passing checks before merging

A repository administrator must configure GitHub; workflow YAML alone cannot block merging:

1. Push this workflow and let **Tests** run at least once so GitHub can offer its check name.
2. Open repository **Settings → Rules → Rulesets**, create or edit a branch ruleset targeting `main`, and set enforcement to Active. Classic branch protection can enforce the same requirements.
3. Enable **Require a pull request before merging** and **Require status checks to pass**.
4. Select **Tests** from GitHub Actions as the required check. Require the branch to be up to date before merging, so changes are checked against the latest `main`.
5. Keep bypass permissions restricted to the team's intended administrators. Do not require **Deploy to AWS**: it intentionally skips PRs and runs after merge.

Existing protections should be preserved. Branch protection/ruleset settings require repository permissions and are not changed by this commit. If merge queues are introduced later, also add a `merge_group` trigger so queued merge commits produce the required check.

## Local equivalent

```sh
python -m pip install -r requirements-test.txt
npm ci
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py migrate --noinput
python manage.py test myapp
npm test
```

A successful local run does not confirm GitHub runner setup or AWS credentials; verify the first hosted Actions run after pushing. After the workflow is merged into `main`, subsequent main pushes are tested before deployment.

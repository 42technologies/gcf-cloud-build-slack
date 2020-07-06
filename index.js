const moment = require('moment');
const { IncomingWebhook } = require('@slack/webhook');
const url = process.env.SLACK_WEBHOOK_URL;

const notifyStatuses = (function () {
  const statuses = process.env.SLACK_NOTIFY_STATUSES;
  if (statuses) return statuses.split(',').map(x => x.toUpperCase());
  // Skip if the current status is not in the status list.
  // Add additional statuses to list if you'd like:
  // QUEUED, WORKING, SUCCESS, FAILURE,
  // INTERNAL_ERROR, TIMEOUT, CANCELLED
  return ['SUCCESS', 'FAILURE', 'INTERNAL_ERROR', 'TIMEOUT', 'CANCELLED'];
})();

const ignoreTags = (function () {
  const tags = process.env.SLACK_IGNORE_TAGS;
  if (tags) return tags.split(',');
  return ['schedule'];
})();

const webhook = url ? new IncomingWebhook(url) : null;

// subscribeSlack is the main function called by Cloud Functions.
module.exports.subscribeSlack = (pubSubEvent, context) => {
  // https://cloud.google.com/cloud-build/docs/send-build-notifications
  // pubSubEvent = {attributes: {buildId, status}, data, message_id}
  const build = eventToBuild(pubSubEvent.data);
  pubSubEvent.data = build;
  console.debug(JSON.stringify(pubSubEvent));

  const message = createSlackMessage(build);
  console.debug(JSON.stringify(message));

  const { tags, status } = build;
  if (!notifyStatuses.includes(status)) return;

  const xTags = (tags || []).filter(v => ignoreTags.includes(v));
  if (xTags.length > 0 && status === 'SUCCESS') return;

  // Send message to Slack.
  if (webhook) {
    webhook.send(message);
  } else {
    console.warn('unable to send message, $SLACK_WEBHOOK_URL not in environment');
  }
};

// eventToBuild transforms pubsub event message to a build object.
const eventToBuild = data => {
  // returns a Build object as described
  // https://cloud.google.com/cloud-build/docs/api/reference/rest/v1/projects.builds
  return JSON.parse(Buffer.from(data, 'base64').toString());
};

// createSlackMessage creates a message from a build object.
const createSlackMessage = build => {
  const { logUrl, status, startTime, finishTime, images, source, sourceProvenance, substitutions } = build;
  const { repoSource } = source || {};
  const { resolvedRepoSource } = sourceProvenance || {};
  let { repoName, branchName, projectId } = repoSource || {};
  let { commitSha, tagName } = resolvedRepoSource || {};

  repoName = repoName || (substitutions || {}).REPO_NAME;
  branchName = branchName || (substitutions || {}).BRANCH_NAME;
  commitSha = commitSha || (substitutions || {}).COMMIT_SHA || (substitutions || {}).REVISION_ID;

  const mrkdwn = (text, verbatim = false) => {
    return { type: 'mrkdwn', text, verbatim };
  };

  const mrkdwnField = (key, value) => {
    return mrkdwn(`*${key}:*\n${value}\n`);
  };

  const mrkdwnLink = (href, text) => {
    if (text) {
      return `<${href}|${text}>`;
    }
    return `<${href}>`;
  };

  const mrkdwnInlineCode = text => `\`${text}\``;

  const mrkdwnTimestamp = text => {
    m = moment(text);
    return `<!date^${m.unix()}^{date_short_pretty} {time_secs}|${text}>`;
  };

  const hasRepoInfo = !!(projectId && repoName && commitSha);
  const commitUrl = hasRepoInfo ? `https://source.cloud.google.com/${projectId}/${repoName}/+/${commitSha}` : null;
  const shortSha = hasRepoInfo ? commitSha.substring(0, 7) : null;
  const commitLink = hasRepoInfo ? mrkdwnLink(commitUrl, mrkdwnInlineCode(shortSha)) : 'n/a';

  const message = {
    text: `${status}: ${branchName || build.id}`,
    blocks: [
      {
        type: 'section',
        text: mrkdwn(mrkdwnLink(logUrl, '*Build Logs*')),
      },
      {
        type: 'section',
        // limit 10
        fields: [
          mrkdwnField('Status', status),
          mrkdwnField('Repo', repoName || 'n/a'),
          mrkdwnField('Branch', branchName || 'n/a'),
          mrkdwnField('Images', (images || []).join('\n')),
          mrkdwnField('Commit', commitLink),
          mrkdwnField('Tag', tagName || 'n/a'),
          mrkdwnField('Start', mrkdwnTimestamp(startTime)),
          mrkdwnField('Finish', mrkdwnTimestamp(finishTime)),
        ],
      },
    ],
  };

  // build.steps.forEach(step => {
  //   const a = moment(step.timing.endTime),
  //     b = moment(step.timing.startTime),
  //     duration = moment.duration(a.diff(b));

  //   message.blocks.push({
  //     type: "section",
  //     fields: [
  //       mrkdwn(`*Step:*\n${step.id}\n`),
  //       mrkdwn(`*Duration:*\n${duration.as("seconds")}s\n`),
  //       mrkdwn(`*Start:*\n${timestamp(step.timing.startTime)}\n`),
  //       mrkdwn(`*Finish:*\n${timestamp(step.timing.endTime)}\n`)
  //     ]
  //   });
  // });

  return message;
};

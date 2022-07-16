const moment = require('moment');
const { IncomingWebhook } = require('@slack/webhook');

// Environment variables
//
// SLACK_WEBHOOK_URL:
// SLACK_IGNORE_TAGS:
// SLACK_NOTIFY_STATUSES:
// SLACK_WEBHOOK_URL_FAILURE:
// SLACK_FAILURE_STATUSES:

const statusCodes = {
  CANCELLED: {
    color: '#fbbc05',
    text: 'Build cancelled',
  },
  FAILURE: {
    color: '#ea4335',
    text: 'Build failed',
  },
  INTERNAL_ERROR: {
    color: '#ea4335',
    text: 'Internal error encountered during build',
  },
  QUEUED: {
    color: '#fbbc05',
    text: 'New build queued',
  },
  SUCCESS: {
    color: '#34a853',
    text: 'Build successfully completed',
  },
  TIMEOUT: {
    color: '#ea4335',
    text: 'Build timed out',
  },
  WORKING: {
    color: '#34a853',
    text: 'New build in progress',
  },
  STATUS_UNKNOWN: {
    color: '#444444',
    text: 'Unknown build status',
  },
};

let { SLACK_WEBHOOK_URL, SLACK_WEBHOOK_URL_FAILURE } = process.env;

if (!SLACK_WEBHOOK_URL) {
  throw new Error('Missing required SLACK_WEBHOOK_URL environment variable.');
}

const webhooks = {
  general: new IncomingWebhook(SLACK_WEBHOOK_URL),
  failure: SLACK_WEBHOOK_URL_FAILURE ? new IncomingWebhook(SLACK_WEBHOOK_URL_FAILURE) : null,
};

const failureStatuses = (() => {
  const statuses = process.env.SLACK_FAILURE_STATUSES;
  if (statuses) return statuses.split(',').map(x => x.toUpperCase());
  return ['FAILURE', 'INTERNAL_ERROR', 'TIMEOUT'];
})();

const notifyStatuses = (() => {
  const statuses = process.env.SLACK_NOTIFY_STATUSES;
  if (statuses) return statuses.split(',').map(x => x.toUpperCase());
  // Skip if the current status is not in the status list.
  // Add additional statuses to list if you'd like:
  // QUEUED, WORKING, SUCCESS, FAILURE,
  // INTERNAL_ERROR, TIMEOUT, CANCELLED
  return ['SUCCESS', 'FAILURE', 'INTERNAL_ERROR', 'TIMEOUT', 'CANCELLED'];
})();

// Don't send slack messages
const ignoreTags = (function () {
  const tags = process.env.SLACK_IGNORE_TAGS;
  if (tags) return tags.split(',');
  return ['schedule'];
})();

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

  if (webhooks.failure && failureStatuses.includes(status)) {
    webhooks.failure.send(message);
  }

  webhooks.general.send(message);
};

// eventToBuild transforms pubsub event message to a build object.
const eventToBuild = (/** @type {string} */ data) => {
  // returns a Build object as described
  // https://cloud.google.com/cloud-build/docs/api/reference/rest/v1/projects.builds
  return JSON.parse(Buffer.from(data, 'base64').toString());
};

const Markdown = (() => {
  /**
   * @arg {any} text
   */
  const markdown = (text, verbatim = false) => {
    return { type: 'mrkdwn', text, verbatim };
  };
  /**
   * @arg {any} key
   * @arg {any} value
   **/
  const field = (key, value) => {
    return markdown(`${key}\n*${value}*`);
  };
  /**
   * @arg {any} href
   * @arg {any} text
   **/
  const link = (href, text) => {
    return text ? `<${href}|${text}>` : `<${href}>`;
  };
  /** @arg {string} text */
  const code = text => {
    return '`' + text + '`';
  };
  const timestamp = (/** @type {any} */ text) => {
    const m = moment(text);
    return `<!date^${m.unix()}^{date_short_pretty} {time_secs}|${text}>`;
  };
  return { markdown, field, link, code, timestamp };
})();

// createSlackMessage creates a message from a build object.
/** @arg {import('@google-cloud/cloudbuild').protos.google.devtools.cloudbuild.v1.Build} build */
const createSlackMessage = build => {
  const statusMsg = {
    text: statusCodes[build.status].text || build.status,
    color: statusCodes[build.status].color || '#444444',
  };
  let { logUrl, startTime, finishTime, images, substitutions, tags } = build;

  tags = tags || [];
  tags = tags.filter(x => !x.startsWith('trigger-'));
  const isScheduler = tags.includes('schedule');

  images = images || [];

  let repoName = (substitutions || {}).REPO_NAME;
  let branchName = (substitutions || {}).BRANCH_NAME;
  let commitSha = (substitutions || {}).COMMIT_SHA || (substitutions || {}).REVISION_ID;

  /** @type {string | null} */
  let orgId = null;
  let type = null;
  if (isScheduler) {
    type = 'Schedule';
    orgId = tags.filter(x => x !== 'schedule').join(', ');
    tags = tags.filter(x => x !== 'schedule' && x !== orgId);
  } else {
    type = 'Build';
  }

  /** @type {any}[] */
  let repoSection = [];
  if (repoName || branchName || commitSha) {
    repoSection = [
      {
        type: 'divider',
      },
      {
        type: 'context',
        elements: [Markdown.field('Branch', branchName || '—')],
      },
      {
        type: 'context',
        elements: [Markdown.field('Commit', commitSha || '—')],
      },
      {
        type: 'context',
        elements: [Markdown.field('Repo', repoName || '—')],
      },
    ];
  }

  const message = {
    text: `${statusMsg.text}: ${type} for ${orgId || branchName || build.id}`,
    color: statusMsg.color,
    blocks: [
      {
        type: 'context',
        elements: [Markdown.markdown(Markdown.link(logUrl, 'Click here to view logs...'))],
      },
      {
        type: 'context',
        elements: [
          Markdown.markdown(`Type: *${type}*`),
          Markdown.markdown(`Status: *${build.status}*`),
          //
        ],
      },
      ...(orgId
        ? [
            {
              type: 'divider',
            },
            {
              type: 'context',
              elements: [Markdown.markdown('Organization ID\n`' + orgId + '`')],
            },
          ]
        : []),

      ...repoSection,

      ...(tags.length > 0
        ? [
            {
              type: 'divider',
            },
            {
              type: 'context',
              elements: [Markdown.field('Tags', (tags || []).map(x => '`' + x + '`').join('\n'))],
            },
          ]
        : []),

      // ...(images.length > 0
      //   ? [
      //       {
      //         type: 'divider',
      //       },
      //       {
      //         type: 'context',
      //         elements: [Markdown.field('Images', (images || []).join('\n'))],
      //       },
      //     ]
      //   : []),
    ],
  };

  return message;
};

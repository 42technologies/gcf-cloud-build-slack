const moment = require("moment");
const { IncomingWebhook } = require("@slack/webhook");
const url = process.env.SLACK_WEBHOOK_URL;

const webhook = new IncomingWebhook(url);

// subscribeSlack is the main function called by Cloud Functions.
module.exports.subscribeSlack = (pubSubEvent, context) => {
  // https://cloud.google.com/cloud-build/docs/send-build-notifications
  // pubSubEvent = {attributes: {buildId, status}, data, message_id}
  const build = eventToBuild(pubSubEvent.data);
  pubSubEvent.data = build;
  console.debug(JSON.stringify(pubSubEvent));

  // Skip if the current status is not in the status list.
  // Add additional statuses to list if you'd like:
  // QUEUED, WORKING, SUCCESS, FAILURE,
  // INTERNAL_ERROR, TIMEOUT, CANCELLED
  const status = [
    "SUCCESS",
    "FAILURE",
    "INTERNAL_ERROR",
    "TIMEOUT",
    "CANCELLED"
  ];
  if (status.indexOf(build.status) === -1) {
    return;
  }

  // Send message to Slack.
  const message = createSlackMessage(build);
  webhook.send(message);
};

// eventToBuild transforms pubsub event message to a build object.
const eventToBuild = data => {
  // returns a Build object as described
  // https://cloud.google.com/cloud-build/docs/api/reference/rest/v1/projects.builds
  return JSON.parse(Buffer.from(data, "base64").toString());
};

// createSlackMessage creates a message from a build object.
const createSlackMessage = build => {
  const { logUrl, status, startTime, finishTime, images } = build;
  const { repoName, branchName, projectId } = build.source.repoSource;
  const { commitSha, tagName } = build.sourceProvenance.resolvedRepoSource;

  const mrkdwn = (text, verbatim = false) => {
    return { type: "mrkdwn", text, verbatim };
  };

  const mrkdwnField = (key, value) => {
    return mrkdwn(`*${key}:*\n${value}\n`);
  };

  const timestamp = text => {
    m = moment(text);
    return `<!date^${m.unix()}^{date_short_pretty} {time_secs}|${text}>`;
  };

  const commitUrl = `https://source.cloud.google.com/${projectId}/${repoName}/+/${commitSha}`;
  const shortSha = commitSha.substring(0, 7);

  const message = {
    text: `${status}: ${branchName}`,
    blocks: [
      {
        type: "section",
        text: mrkdwn(`*<${logUrl}|Build Logs>*\n`)
      },
      {
        type: "section",
        // limit 10
        fields: [
          mrkdwnField('Status', status),
          mrkdwnField('Repo', repo),
          mrkdwnField('Branch', branchName),
          mrkdwnField('Images', images.join('\n')),
          mrkdwn(`*Commit:*\n<${commitUrl}|\`${shortSha}\`>\n`),
          mrkdwnField('Tag', tagName || 'n/a'),
          mrkdwnField('Start', timestamp(startTime)),
          mrkdwnField('Finish', timestamp(finishTime))
        ]
      }
    ]
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

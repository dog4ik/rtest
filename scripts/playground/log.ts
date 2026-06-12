export const counters = {
  created: 0,
  approved: 0,
  declined: 0,
  expired: 0,
  disputed: 0,
  failed: 0,
  healthchecksPassed: 0,
  healthchecksFailed: 0,
};

function ts() {
  return new Date().toISOString().slice(11, 23);
}

export function log(scope: string, msg: string, data?: unknown) {
  let prefix = `${ts()} [${scope}]`;
  if (data !== undefined) {
    console.log(prefix, msg, data);
  } else {
    console.log(prefix, msg);
  }
}

export function summary() {
  log("summary", "playground counters", { ...counters });
}

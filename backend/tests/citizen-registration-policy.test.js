const test = require("node:test");
const assert = require("node:assert/strict");
const { requireCitizenRegistrationEnabled } = require("../middleware/citizenRegistration.middleware");

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test("citizen registration preserves existing enabled behavior by default", () => {
  const previous = process.env.ALLOW_CITIZEN_REGISTRATION;
  delete process.env.ALLOW_CITIZEN_REGISTRATION;
  const res = responseRecorder();
  let nextCalls = 0;
  try {
    requireCitizenRegistrationEnabled({}, res, () => { nextCalls += 1; });
    assert.equal(nextCalls, 1);
    assert.equal(res.statusCode, null);
  } finally {
    if (previous === undefined) delete process.env.ALLOW_CITIZEN_REGISTRATION;
    else process.env.ALLOW_CITIZEN_REGISTRATION = previous;
  }
});

test("citizen registration can be explicitly disabled", () => {
  const previous = process.env.ALLOW_CITIZEN_REGISTRATION;
  process.env.ALLOW_CITIZEN_REGISTRATION = "false";
  const res = responseRecorder();
  let nextCalls = 0;
  try {
    requireCitizenRegistrationEnabled({}, res, () => { nextCalls += 1; });
    assert.equal(res.statusCode, 403);
    assert.equal(nextCalls, 0);
  } finally {
    if (previous === undefined) delete process.env.ALLOW_CITIZEN_REGISTRATION;
    else process.env.ALLOW_CITIZEN_REGISTRATION = previous;
  }
});

test("invalid citizen registration setting fails closed", () => {
  const previous = process.env.ALLOW_CITIZEN_REGISTRATION;
  process.env.ALLOW_CITIZEN_REGISTRATION = "sometimes";
  const res = responseRecorder();
  let nextCalls = 0;
  try {
    requireCitizenRegistrationEnabled({}, res, () => { nextCalls += 1; });
    assert.equal(res.statusCode, 503);
    assert.equal(nextCalls, 0);
  } finally {
    if (previous === undefined) delete process.env.ALLOW_CITIZEN_REGISTRATION;
    else process.env.ALLOW_CITIZEN_REGISTRATION = previous;
  }
});

const { Readable } = require("node:stream");
const test = require("node:test");
const assert = require("node:assert/strict");

const reportBackend = require("../server/report_backend.js");

async function dispatch(server, { method = "POST", url = "/v1/report", body = "" } = {}) {
  const handler = server.listeners("request")[0];
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.url = url;

  const res = {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(value = "") {
      this.body += String(value);
    }
  };

  await handler(req, res);
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: res.body ? JSON.parse(res.body) : null
  };
}

test("createServer serves report and gist requests with the correct prompt", async () => {
  const calls = [];
  const server = reportBackend.createServer({
    env: {
      OPENAI_API_KEY: "openai-key",
      OPENAI_MODEL: "gpt-test"
    },
    fetchImpl: async (url, options = {}) => {
      const body = JSON.parse(options.body);
      calls.push({
        url: String(url),
        model: body.model,
        systemPrompt: body.messages[0].content,
        artifact: JSON.parse(body.messages[1].content)
      });
      return {
        ok: true,
        async json() {
          return {
            choices: [{
              message: { content: "Generated text." }
            }]
          };
        }
      };
    }
  });

  const reportResponse = await dispatch(server, {
    url: "/v1/report",
    body: JSON.stringify({ artifact: { path: [{ id: "1" }], references: [], people: [], replyChains: [] } })
  });
  const gistResponse = await dispatch(server, {
    url: "/v1/gist",
    body: JSON.stringify({ artifact: { path: [{ id: "2" }], references: [], people: [], replyChains: [] } })
  });

  assert.equal(reportResponse.statusCode, 200);
  assert.equal(gistResponse.statusCode, 200);
  assert.equal(reportResponse.body.report.text, "Generated text.");
  assert.equal(calls[0].model, "gpt-test");
  assert.match(calls[0].systemPrompt, /narrative/i);
  assert.match(calls[1].systemPrompt, /gist/i);
  assert.deepEqual(calls[0].artifact.path, [{ id: "1" }]);
  assert.deepEqual(calls[1].artifact.path, [{ id: "2" }]);
});

test("createServer handles options, missing artifact, unsupported routes, and model failures", async () => {
  const okServer = reportBackend.createServer({
    env: { OPENAI_API_KEY: "openai-key" },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: "ok" } }]
        };
      }
    })
  });

  assert.deepEqual(await dispatch(okServer, { method: "OPTIONS", url: "/v1/report" }), {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: { ok: true }
  });
  assert.equal((await dispatch(okServer, { method: "GET", url: "/v1/report" })).statusCode, 404);
  assert.deepEqual(
    await dispatch(okServer, { url: "/v1/report", body: JSON.stringify({}) }),
    {
      statusCode: 400,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: { ok: false, error: "missing_report_artifact" }
    }
  );

  const failingServer = reportBackend.createServer({
    env: { OPENAI_API_KEY: "openai-key" },
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async text() {
        return "bad key";
      }
    })
  });
  const failure = await dispatch(failingServer, {
    url: "/v1/report",
    body: JSON.stringify({ artifact: { path: [] } })
  });

  assert.equal(failure.statusCode, 500);
  assert.match(failure.body.error, /report_generation_failed_401:bad key/);
});

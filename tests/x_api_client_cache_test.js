const test = require("node:test");
const assert = require("node:assert/strict");

const xApiClient = require("../data/x_api_client.js");

test("fetchTweetById reuses entity cache across repeated lookups", async () => {
  let requestCount = 0;
  const entityCache = {
    tweets: new Map(),
    users: new Map(),
    getTweet(id) {
      return this.tweets.get(String(id)) || null;
    },
    setTweet(tweet) {
      this.tweets.set(String(tweet.id), tweet);
    },
    getUser(id) {
      return this.users.get(String(id)) || null;
    },
    setUser(user) {
      this.users.set(String(user.id), user);
    }
  };

  const client = await xApiClient.createClient({
    bearerToken: "test-token",
    entityCache,
    fetchImpl: async () => {
      requestCount += 1;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            data: {
              id: "100",
              author_id: "u1",
              text: "Root"
            },
            includes: {
              users: [{ id: "u1", username: "alice", name: "Alice" }]
            }
          };
        }
      };
    }
  });

  const first = await xApiClient.fetchTweetById(client, "100");
  const second = await xApiClient.fetchTweetById(client, "100");

  assert.equal(requestCount, 1);
  assert.equal(first.tweet.id, "100");
  assert.equal(second.tweet.id, "100");
  assert.equal(second.users.length, 1);
  assert.equal(second.users[0].id, "u1");
});

test("fetchUsersByIds only requests uncached ids", async () => {
  let requestCount = 0;
  const entityCache = {
    tweets: new Map(),
    users: new Map([
      ["u1", { id: "u1", username: "cached", name: "Cached" }]
    ]),
    getTweet(id) {
      return this.tweets.get(String(id)) || null;
    },
    setTweet(tweet) {
      this.tweets.set(String(tweet.id), tweet);
    },
    getUser(id) {
      return this.users.get(String(id)) || null;
    },
    setUser(user) {
      this.users.set(String(user.id), user);
    }
  };

  const client = await xApiClient.createClient({
    bearerToken: "test-token",
    entityCache,
    fetchImpl: async (urlString) => {
      requestCount += 1;
      const url = new URL(urlString);
      assert.equal(url.pathname, "/2/users");
      assert.equal(url.searchParams.get("ids"), "u2");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            data: [{ id: "u2", username: "fresh", name: "Fresh" }]
          };
        }
      };
    }
  });

  const users = await xApiClient.fetchUsersByIds(client, ["u1", "u2"]);

  assert.equal(requestCount, 1);
  assert.deepEqual(users.map((user) => user.id).sort(), ["u1", "u2"]);
  assert.equal(entityCache.users.get("u2").username, "fresh");
});

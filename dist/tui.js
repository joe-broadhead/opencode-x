// src/tui.ts
import { Plugin } from "@opencode/plugin/tui";

// src/redact.ts
var SECRETS = [
  [/\b(bearer|basic|token)\s+[\w.~+/=-]{8,}/gi, "$1 [redacted]"],
  [/\b([\w-]*(?:api[_-]?key|access[_-]?key|private[_-]?key|token|secret|password|signature|credential)["']?\s*[:=]\s*)["']?[^\s"'&,;]+["']?/gi, "$1[redacted]"],
  [/\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g, "[redacted]"],
  [/\b(?:tvly|sk|pk|rk|ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abposr]|lin_api|lin_oauth)[-_][\w-]{8,}/gi, "[redacted]"],
  [/[\w+=-]{40,}/g, "[redacted]"]
];
var REASON_LIMIT = 160;
var CONTROLS = /[\u0000-\u001f\u007f-\u009f]+/g;
var BIDI = /[‎‏‪-‮⁦-⁩]/g;
var withoutUrlSecrets = (text) => text.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (url) => url.replace(/^(https?:\/\/)[^/?#@]*@/i, "$1").replace(/[?#].*$/s, ""));
var oneLine = (text) => text.replace(BIDI, "").replace(CONTROLS, " ").replace(/\s+/g, " ").trim();
function cut(text, limit) {
  const characters = Array.from(text);
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}\u2026` : text;
}
function shortReason(text) {
  const reason = oneLine(SECRETS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), withoutUrlSecrets(text))).replace(/[.\s]+$/, "");
  if (reason === "") return void 0;
  return cut(reason, REASON_LIMIT);
}

// src/tui.ts
import { createSignal } from "solid-js";

// src/constants.ts
var PLUGIN_ID = "x.posts";
var SERVER_NAME = "x";
var DISPLAY_NAME = "X";
var ENDPOINT = "https://api.x.com/mcp";
var SCOPES = [
  "tweet.read",
  "users.read",
  "follows.read",
  "like.read",
  "block.read",
  "list.read",
  "list.write",
  "space.read",
  "broadcast.read",
  "calls.read",
  "bookmark.read",
  "bookmark.write",
  "tweet.write",
  "offline.access"
];
var SUPPORTED_HOST = ">=2.2.3 <2.3.0";
var TESTED_HOSTS = ["2.2.3", "2.2.4", "2.2.5", "2.2.6"];
var errorText = (code, message, nextStep) => `${code}: ${message} Next step: ${nextStep}`;

// src/host/events-list.ts
var EVENTS_LIST = "events_list";

// src/host-version.ts
var RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;
var parse = (version) => RELEASE.exec(version)?.slice(1).map(Number);
var [LOWEST, ABOVE] = SUPPORTED_HOST.split(" ").map((bound) => parse(bound.replace(/^[<>]=?/, "")));
var compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
function isSupportedHost(version) {
  const parts = parse(version);
  return parts !== void 0 && compare(parts, LOWEST) >= 0 && compare(parts, ABOVE) < 0;
}

// src/x-tools.ts
var READ_TOOLS = [
  "get_broadcast",
  "get_broadcast_chat",
  "get_chat_moderators",
  "get_communities_by_id",
  "get_lists_by_id",
  "get_lists_followers",
  "get_lists_members",
  "get_lists_posts",
  "get_news",
  "get_posts_by_id",
  "get_posts_by_ids",
  "get_posts_counts_recent",
  "get_posts_liking_users",
  "get_posts_quoted_posts",
  "get_posts_reposted_by",
  "get_scheduled_broadcast",
  "get_source",
  "get_scheduled_call",
  "get_spaces_by_creator_ids",
  "get_spaces_by_id",
  "get_spaces_by_ids",
  "get_spaces_posts",
  "get_trends_by_woeid",
  "get_usage_credits",
  "get_users_blocking",
  "get_users_bookmark_folders",
  "get_users_bookmarks",
  "get_users_bookmarks_by_folder_id",
  "get_users_by_id",
  "get_users_by_username",
  "get_users_by_usernames",
  "get_users_followed_lists",
  "get_users_liked_posts",
  "get_users_list_memberships",
  "get_users_me",
  "get_users_me_followers",
  "get_users_me_following",
  "get_users_mentions",
  "get_users_owned_lists",
  "get_users_pinned_lists",
  "get_users_posts",
  "get_users_timeline",
  "list_broadcasts",
  "list_scheduled_broadcasts",
  "list_scheduled_calls",
  "list_sources",
  "search_communities",
  "search_news",
  "search_posts_all",
  "search_spaces",
  "search_users"
];
var WRITE_TOOLS = [
  "article_create_draft",
  "create_lists",
  "create_users_bookmark",
  "create_users_bookmark_folder",
  "delete_users_bookmark",
  "pin_list",
  "unpin_list",
  "update_lists"
];
var PUBLIC_TOOLS = [
  "create_posts"
];
var DENY_TOOLS = [
  "accept_chat_message_request",
  "add_chat_moderator",
  "add_conversation_keys",
  "add_lists_member",
  "archive_chat_conversation",
  "cancel_scheduled_call",
  "chat_media_download",
  "chat_media_upload_append",
  "chat_media_upload_finalize",
  "chat_media_upload_initialize",
  "create_scheduled_broadcast",
  "create_source",
  "delete_scheduled_broadcast",
  "delete_source",
  "follow_list",
  "get_chat_conversation",
  "get_chat_conversation_events",
  "get_chat_conversations",
  "get_chat_message_request",
  "get_chat_message_requests",
  "get_users_public_key",
  "get_users_public_keys",
  "go_live_scheduled_broadcast",
  "mark_chat_conversation_read",
  "mark_chat_conversation_unread",
  "mute_broadcast_chat_user",
  "remove_chat_moderator",
  "remove_lists_member_by_user_id",
  "respond_to_scheduled_call",
  "schedule_call",
  "send_chat_message",
  "send_chat_typing_indicator",
  "unarchive_chat_conversation",
  "unfollow_list",
  "unmute_broadcast_chat_user",
  "update_scheduled_broadcast",
  "update_scheduled_call",
  "update_source",
  "users_id_block",
  "users_id_unblock"
];

// src/permissions.ts
var actionOf = (tool) => `${SERVER_NAME}_${tool}`;
var rule = (tool, effect) => ({ action: actionOf(tool), resource: "*", effect });
var defaultRules = (access = "all") => access === "all" ? [rule("*", "allow")] : access === "ask-changes" ? [rule("*", "ask"), ...[...READ_TOOLS, EVENTS_LIST].map((tool) => rule(tool, "allow"))] : [rule("*", "deny"), ...[...READ_TOOLS, EVENTS_LIST].map((tool) => rule(tool, "allow"))];

// src/prices.ts
var resource = (kind, perResourceUsd) => ({ kind, perResourceUsd });
var request = (perRequestUsd) => ({ kind: "request", perRequestUsd });
var POST = resource("post", 5e-3);
var USER = resource("user", 0.01);
var OWNED = { kind: "post", perResourceUsd: 5e-3, ownedUsd: 1e-3 };
var OWNED_USER = { kind: "user", perResourceUsd: 0.01, ownedUsd: 1e-3 };
var LIST = resource("list", 5e-3);
var SPACE = resource("space", 5e-3);
var COMMUNITY = resource("community", 5e-3);
var NEWS = resource("news", 5e-3);
var DM = resource("dm", 0.01);
var PRICES = {
  // Posts and users, at their published resource rates.
  search_posts_all: POST,
  get_posts_by_id: POST,
  get_posts_by_ids: POST,
  get_posts_quoted_posts: POST,
  get_lists_posts: POST,
  get_spaces_posts: POST,
  get_users_timeline: POST,
  search_users: USER,
  get_users_by_id: USER,
  get_users_by_username: USER,
  get_users_by_usernames: USER,
  get_users_me: USER,
  get_lists_members: USER,
  get_lists_followers: USER,
  get_posts_liking_users: USER,
  get_posts_reposted_by: USER,
  get_chat_moderators: USER,
  // Owned Reads: the 12 endpoints X discounts when the caller owns the data.
  get_users_mentions: { ...OWNED, ownedUsd: 1e-3 },
  get_users_posts: { ...OWNED, ownedUsd: 1e-3 },
  get_users_liked_posts: { ...OWNED, ownedUsd: 1e-3 },
  get_users_bookmarks: { ...OWNED, ownedUsd: 1e-3 },
  get_users_bookmarks_by_folder_id: { ...OWNED, ownedUsd: 1e-3 },
  get_users_bookmark_folders: { ...OWNED, ownedUsd: 1e-3 },
  get_users_me_followers: OWNED_USER,
  get_users_me_following: OWNED_USER,
  get_users_blocking: OWNED_USER,
  get_users_owned_lists: { ...OWNED, ownedUsd: 1e-3 },
  get_users_followed_lists: { ...OWNED, ownedUsd: 1e-3 },
  get_users_list_memberships: { ...OWNED, ownedUsd: 1e-3 },
  get_users_pinned_lists: { ...OWNED, ownedUsd: 1e-3 },
  // Lists, Spaces, Communities, News and DM resources.
  get_lists_by_id: LIST,
  get_broadcast: SPACE,
  get_scheduled_broadcast: SPACE,
  get_scheduled_call: SPACE,
  get_spaces_by_creator_ids: SPACE,
  get_spaces_by_id: SPACE,
  get_spaces_by_ids: SPACE,
  list_broadcasts: SPACE,
  list_scheduled_broadcasts: SPACE,
  list_scheduled_calls: SPACE,
  search_spaces: SPACE,
  get_communities_by_id: COMMUNITY,
  search_communities: COMMUNITY,
  get_news: NEWS,
  search_news: NEWS,
  get_broadcast_chat: DM,
  get_chat_conversation: DM,
  get_chat_conversation_events: DM,
  get_chat_conversations: DM,
  get_chat_message_request: DM,
  get_chat_message_requests: DM,
  // Request-priced reads.
  get_posts_counts_recent: request(5e-3),
  get_trends_by_woeid: request(0.01),
  get_source: request(5e-3),
  list_sources: request(5e-3),
  get_users_public_key: request(5e-3),
  get_users_public_keys: request(5e-3),
  get_usage_credits: request(0),
  // Writes.
  article_create_draft: request(5e-3),
  create_lists: request(0.01),
  create_users_bookmark: request(5e-3),
  create_users_bookmark_folder: request(5e-3),
  delete_users_bookmark: request(5e-3),
  pin_list: request(5e-3),
  unpin_list: request(5e-3),
  update_lists: request(5e-3),
  create_posts: { kind: "postCreate", perRequestUsd: 0.015, withUrlUsd: 0.2 },
  // The off tools, priced by the published category they belong to, for an agent that allows one.
  follow_list: request(0.015),
  unfollow_list: request(0.015),
  users_id_block: request(0.015),
  users_id_unblock: request(0.015),
  add_lists_member: request(5e-3),
  remove_lists_member_by_user_id: request(5e-3),
  accept_chat_message_request: request(0.015),
  add_chat_moderator: request(0.015),
  remove_chat_moderator: request(0.015),
  archive_chat_conversation: request(0.015),
  unarchive_chat_conversation: request(0.015),
  mark_chat_conversation_read: request(0.015),
  mark_chat_conversation_unread: request(0.015),
  send_chat_message: request(0.015),
  send_chat_typing_indicator: request(0.015),
  mute_broadcast_chat_user: request(1e-3),
  unmute_broadcast_chat_user: request(1e-3),
  cancel_scheduled_call: request(0.015),
  respond_to_scheduled_call: request(0.015),
  schedule_call: request(0.015),
  create_scheduled_broadcast: request(5e-3),
  delete_scheduled_broadcast: request(5e-3),
  update_scheduled_broadcast: request(5e-3),
  update_scheduled_call: request(0.015),
  create_source: request(5e-3),
  delete_source: request(5e-3),
  update_source: request(5e-3),
  go_live_scheduled_broadcast: request(5e-3),
  chat_media_download: request(5e-3),
  chat_media_upload_append: request(5e-3),
  chat_media_upload_finalize: request(5e-3),
  chat_media_upload_initialize: request(5e-3),
  add_conversation_keys: request(0.015)
};

// src/billing.ts
var DAY_MS = 24 * 60 * 60 * 1e3;
var writing = Promise.resolve();

// src/status.ts
var agentRulesText = (access) => defaultRules(access).map((rule2, index, rules) => `  ${JSON.stringify(rule2)}${index < rules.length - 1 ? "," : ""}`).join("\n");
var TESTED_TEXT = `${TESTED_HOSTS.slice(0, -1).join(", ")} or ${TESTED_HOSTS.at(-1)}`;
var NO_TOOLS = `X lists no tools for this app. Check that the app is in Pay-per-use, Production at console.x.com, that it has the OAuth 2.0 scopes ${SCOPES.join(" ")}, then sign in again.`;
var STATE_TEXT = {
  connected: "connected",
  connecting: "connecting",
  sign_in_required: "sign-in required",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
  conflict: "conflict",
  host_untested: "host untested"
};
var RULES_NOT_ADDED = "RULES_NOT_ADDED:";
function serverText(source) {
  if (source.type === "plugin") return `${source.url}, registered by this plugin`;
  if (source.type === "adopted") return `${source.url}, your own mcp.servers.${SERVER_NAME}${source.signIn === "own" ? " without OAuth" : ""}, used unchanged`;
  return `your mcp.servers.${SERVER_NAME} points at ${source.url}`;
}
function toolsText({ tools, unknownCount, unknownTools, deniedTools, deniedCount, listing, access }) {
  if (listing) return "none listed yet (X is still listing them)";
  const hiddenDenied = deniedCount - deniedTools.length;
  const off = deniedCount ? `; denied by access: ${list(deniedTools)}${hiddenDenied > 0 ? ` and ${hiddenDenied} more` : ""}` : "";
  const unknown = access === "read-only" ? "are denied" : access === "ask-changes" ? "ask before running" : "run without asking";
  if (unknownCount === 0) return `${tools} available, 0 unknown${off}`;
  const more = unknownCount - unknownTools.length;
  const names = unknownTools.length ? `: ${unknownTools.join(", ")}${more > 0 ? ` and ${more} more` : ""}` : "";
  return `${tools} available, ${unknownCount} unknown${names} (unknown tools ${unknown})${off}`;
}
var list = (names) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
var ACCESS_TEXT = {
  all: "every X tool is allowed by default, writes included",
  "ask-changes": `reads run without asking; every other X tool asks (${WRITE_TOOLS.length + PUBLIC_TOOLS.length + DENY_TOOLS.length} tools)`,
  "read-only": `reads run without asking; every other X tool is denied (${WRITE_TOOLS.length + PUBLIC_TOOLS.length + DENY_TOOLS.length} tools)`
};
var POSTURE = (access) => `${ACCESS_TEXT[access]}; X bills every tool call to the X developer account that owns the app`;
function accessText({ problems, unguardedAgents: unguardedAgents2, access }) {
  const rules = problems.some((problem) => problem.startsWith(RULES_NOT_ADDED)) ? "default rules not added (see the OpenCode row)" : unguardedAgents2.length ? "default rules missing in the agents listed below" : "no agent runs new X tools unasked";
  return `${POSTURE(access ?? "all")}; ${rules}`;
}
function scriptsText(billing) {
  return `estimated spend, at most: $${billing.dailySpentUsd.toFixed(2)} of $${billing.dailyBudgetUsd.toFixed(2)} in the last 24 hours; $${billing.sessionBudgetUsd.toFixed(2)} per session; X's Developer Console has the real bill`;
}
function hostText({ host, problems }) {
  const { version, range, tested } = host;
  const outside = version === null || !isSupportedHost(version);
  const notes = [
    ...outside ? [`It is outside the supported range; the plugin runs because allowUntestedHost is true. If X misbehaves, use OpenCode ${TESTED_TEXT}.`] : [],
    ...problems
  ];
  return `${version ?? "unknown version"} (${tested ? "tested" : "untested"}; supported range ${range})${notes.length ? `. ${notes.join(" ")}` : ""}`;
}
var CLIENT_SOURCE = { options: "set in plugin options", connect: "saved in /connect" };
var CLIENT_APP = { options: "configured app", connect: "your own app" };
function rows(status) {
  const { source, unguardedAgents: agents, client } = status;
  const details = [status.error, source && serverText(source), status.listing && "still listing its tools"].filter(Boolean).join("; ");
  const head = `${STATE_TEXT[status.state]}${status.code === void 0 ? "" : `. ${status.code}: ${status.message ?? ""}`}${details ? ` (${details})` : ""}`;
  const out = [
    { label: "Connection", value: head },
    { label: "Account", value: status.account ?? `account name not reported by ${DISPLAY_NAME}'s MCP` },
    { label: "Access", value: accessText(status) },
    ...status.billing ? [{ label: "Scripts", value: scriptsText(status.billing) }] : [],
    { label: "Server", value: `${SERVER_NAME} at ${ENDPOINT}` }
  ];
  if (client !== void 0) {
    const app = `${CLIENT_APP[client.source]}, ${client.mode === "public_pkce" ? "public" : "confidential"}`;
    out.push({ label: "Client", value: `${client.id} (${app}; ${CLIENT_SOURCE[client.source]})` });
  }
  if (status.callback !== void 0) out.push({ label: "Callback", value: callbackRow(status.callback, status.callbackPort) });
  if (status.scopes !== void 0) out.push({ label: "Scopes", value: status.scopes.join(" ") });
  out.push(
    { label: "Tools", value: toolsText(status) },
    { label: "Agents without default rules", value: agents.length ? `${agents.join(", ")}
${agentRulesText(status.access ?? "all")}` : "none" },
    { label: "OpenCode", value: hostText(status) },
    { label: "Next step", value: status.nextStep }
  );
  return out;
}
function callbackRow(callback, port) {
  const register = "register exactly this URL in the app's User authentication settings";
  if (port === void 0) return `${callback} (${register})`;
  return `${callback} (${register}, and forward it to http://127.0.0.1:${port}${new URL(callback).pathname}, where OpenCode listens)`;
}
function formatStatus(status, options = {}) {
  const lines = rows(status).map((row) => {
    if (!options.compactRules || row.label !== "Agents without default rules" || row.value === "none") return `- ${row.label}: ${row.value}`;
    const [names] = row.value.split("\n");
    return `- ${row.label}: ${names}
  ${defaultRules(status.access ?? "all").length} rules; run /x-status to copy the block.`;
  });
  return ["X status", ...lines].join("\n");
}
var strings = { type: "array", items: { type: "string" } };
var count = { type: "integer", minimum: 0 };
var nullableString = { type: ["string", "null"] };
var StatusRpc = {
  id: PLUGIN_ID,
  methods: {
    status: {
      input: { type: "object" },
      output: {
        type: "object",
        required: ["version", "state", "tools", "deniedTools", "deniedCount", "listing", "unknownCount", "unknownTools", "unguardedAgents", "host", "problems", "nextStep"],
        properties: {
          version: { type: "string" },
          state: { enum: ["connected", "sign_in_required", "connecting", "disabled", "failed", "not_configured", "conflict", "host_untested"] },
          code: { enum: ["OPTIONS_INVALID", "HOST_UNTESTED", "CLIENT_ID_MISSING", "CLIENT_ID_INVALID"] },
          message: { type: "string" },
          error: { type: "string" },
          source: {
            type: "object",
            required: ["type", "url"],
            properties: { type: { enum: ["plugin", "adopted", "conflict"] }, url: { type: "string" }, expected: { type: "string" }, signIn: { enum: ["oauth", "own"] } }
          },
          account: { type: "string" },
          client: {
            type: "object",
            required: ["id", "mode", "source"],
            properties: { id: { type: "string" }, mode: { enum: ["public_pkce", "confidential"] }, source: { enum: ["options", "connect"] } }
          },
          callback: { type: "string" },
          callbackPort: { type: "integer", minimum: 1, maximum: 65535 },
          scopes: strings,
          tools: count,
          deniedTools: strings,
          deniedCount: count,
          listing: { type: "boolean" },
          unknownCount: count,
          unknownTools: strings,
          unguardedAgents: strings,
          access: { enum: ["all", "ask-changes", "read-only"] },
          billing: {
            type: "object",
            required: ["dailySpentUsd", "dailyBudgetUsd", "sessionBudgetUsd"],
            properties: { dailySpentUsd: { type: "number" }, dailyBudgetUsd: { type: "number" }, sessionBudgetUsd: { type: "number" } }
          },
          shadowedSkills: {
            type: "array",
            items: { type: "object", required: ["id", "path"], properties: { id: { type: "string" }, path: { type: "string" } } }
          },
          host: {
            type: "object",
            required: ["version", "range", "tested"],
            properties: { version: nullableString, range: { type: "string" }, tested: { type: "boolean" } }
          },
          problems: strings,
          nextStep: { type: "string" }
        }
      },
      errors: { unavailable: { type: "object", required: ["nextStep"], properties: { nextStep: { type: "string" } } } }
    }
  },
  events: {}
};

// src/tui.ts
var TUI_ID = "x.posts.tui";
var TITLE = "X status";
var KEYS = "r refresh \xB7 esc close";
function viewMessage(result) {
  return `${reportOf(result)}

${KEYS}`;
}
function reportOf(result) {
  if ("status" in result) return formatStatus(result.status, { compactRules: true }).split("\n").slice(1).join("\n");
  const { error } = result;
  const type = typeof error === "object" && error !== null && "type" in error ? error.type : void 0;
  if (type === "unavailable") {
    const { message, data } = error;
    if (typeof message === "string" && typeof data?.nextStep === "string") return `${message} Next step: ${data.nextStep}`;
  }
  if (type === "rpc.unavailable" || type === "rpc.method_not_found") {
    return errorText("STATUS_UNAVAILABLE", "The X plugin is not running on this OpenCode server.", "Run /plugins to see why it did not start.");
  }
  const reason = shortReason(typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error));
  return errorText("STATUS_UNAVAILABLE", `Could not read X's status${reason ? ` (${reason})` : ""}.`, "Restart OpenCode, then run /x again.");
}
function setupView(context) {
  let open;
  let latest = 0;
  let stops = [];
  const unsubscribe = () => {
    for (const stop of stops.splice(0)) stop();
  };
  const subscribe = () => {
    if (stops.length) return;
    stops = [
      context.data.on("mcp.status.changed", (event) => {
        if (event.data.server === SERVER_NAME) refresh();
      }),
      // Status events can be missed while the TUI is reconnecting.
      context.data.on("server.connected", refresh),
      context.data.on("agent.updated", refresh),
      // Signing in, out or switching accounts changes the account and the sign-in state.
      context.data.on("integration.updated", refresh),
      context.data.on("credential.updated", refresh),
      context.data.on("credential.switched", refresh)
    ];
  };
  const [shown, setShown] = createSignal(false);
  const show = async (refresh2) => {
    if (refresh2 && open === void 0) return;
    const request2 = ++latest;
    const location = context.location;
    const result = await context.client.rpc(StatusRpc).status({}, location ? { location } : {}).then((status) => ({ status }), (error) => ({ error }));
    if (request2 !== latest || refresh2 && open === void 0) return;
    open = request2;
    setShown(true);
    subscribe();
    void context.ui.dialog.alert({ title: TITLE, message: viewMessage(result) }).then(() => {
      if (open !== request2) return;
      open = void 0;
      setShown(false);
      unsubscribe();
    });
    context.ui.dialog.set({ size: "large" });
  };
  const refresh = () => void show(true);
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "x.posts.status",
        title: "X: Status",
        description: "Sign-in, account, tools and the next step for X",
        group: "X",
        palette: true,
        slash: { name: "x" },
        run: () => show(false)
      },
      { id: "x.posts.status.refresh", title: "Refresh X status", group: "X", bind: "r", enabled: shown, run: refresh }
    ]
  }));
  return () => {
    unsubscribe();
    if (open === void 0) return;
    open = void 0;
    setShown(false);
    context.ui.dialog.clear();
  };
}
var tui_default = Plugin.define({ id: TUI_ID, setup: setupView });
export {
  tui_default as default,
  setupView,
  viewMessage
};

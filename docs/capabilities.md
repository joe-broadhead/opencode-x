# Capabilities

Every method, source, action and bus event the manifest declares. The manifest is `capabilities` in `package.json`;
this page adds the notes a person needs to read it.

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `probe` | read | optional | `get_users_me` |
| `events_list` | read | optional | — |
| `mcp:get_broadcast` | read | optional | `get_broadcast` |
| `mcp:get_broadcast_chat` | read | optional | `get_broadcast_chat` |
| `mcp:get_chat_conversation` | read | optional | `get_chat_conversation` |
| `mcp:get_chat_conversation_events` | read | optional | `get_chat_conversation_events` |
| `mcp:get_chat_conversations` | read | optional | `get_chat_conversations` |
| `mcp:get_chat_message_requests` | read | optional | `get_chat_message_requests` |
| `mcp:get_chat_moderators` | read | optional | `get_chat_moderators` |
| `mcp:get_communities_by_id` | read | optional | `get_communities_by_id` |
| `mcp:get_lists_by_id` | read | optional | `get_lists_by_id` |
| `mcp:get_lists_followers` | read | optional | `get_lists_followers` |
| `mcp:get_lists_members` | read | optional | `get_lists_members` |
| `mcp:get_lists_posts` | read | optional | `get_lists_posts` |
| `mcp:get_news` | read | optional | `get_news` |
| `mcp:get_posts_by_id` | read | optional | `get_posts_by_id` |
| `mcp:get_posts_by_ids` | read | optional | `get_posts_by_ids` |
| `mcp:get_posts_counts_recent` | read | optional | `get_posts_counts_recent` |
| `mcp:get_posts_liking_users` | read | optional | `get_posts_liking_users` |
| `mcp:get_posts_quoted_posts` | read | optional | `get_posts_quoted_posts` |
| `mcp:get_posts_reposted_by` | read | optional | `get_posts_reposted_by` |
| `mcp:get_scheduled_broadcast` | read | optional | `get_scheduled_broadcast` |
| `mcp:get_scheduled_call` | read | optional | `get_scheduled_call` |
| `mcp:get_source` | read | optional | `get_source` |
| `mcp:get_spaces_by_creator_ids` | read | optional | `get_spaces_by_creator_ids` |
| `mcp:get_spaces_by_id` | read | optional | `get_spaces_by_id` |
| `mcp:get_spaces_by_ids` | read | optional | `get_spaces_by_ids` |
| `mcp:get_spaces_posts` | read | optional | `get_spaces_posts` |
| `mcp:get_trends_by_woeid` | read | optional | `get_trends_by_woeid` |
| `mcp:get_usage_credits` | read | optional | `get_usage_credits` |
| `mcp:get_users_blocking` | read | optional | `get_users_blocking` |
| `mcp:get_users_bookmark_folders` | read | optional | `get_users_bookmark_folders` |
| `mcp:get_users_bookmarks` | read | optional | `get_users_bookmarks` |
| `mcp:get_users_bookmarks_by_folder_id` | read | optional | `get_users_bookmarks_by_folder_id` |
| `mcp:get_users_by_id` | read | optional | `get_users_by_id` |
| `mcp:get_users_by_username` | read | optional | `get_users_by_username` |
| `mcp:get_users_by_usernames` | read | optional | `get_users_by_usernames` |
| `mcp:get_users_followed_lists` | read | optional | `get_users_followed_lists` |
| `mcp:get_users_liked_posts` | read | optional | `get_users_liked_posts` |
| `mcp:get_users_list_memberships` | read | optional | `get_users_list_memberships` |
| `mcp:get_users_me` | read | optional | `get_users_me` |
| `mcp:get_users_me_followers` | read | optional | `get_users_me_followers` |
| `mcp:get_users_me_following` | read | optional | `get_users_me_following` |
| `mcp:get_users_mentions` | read | optional | `get_users_mentions` |
| `mcp:get_users_owned_lists` | read | optional | `get_users_owned_lists` |
| `mcp:get_users_pinned_lists` | read | optional | `get_users_pinned_lists` |
| `mcp:get_users_posts` | read | optional | `get_users_posts` |
| `mcp:get_users_public_key` | read | optional | `get_users_public_key` |
| `mcp:get_users_public_keys` | read | optional | `get_users_public_keys` |
| `mcp:get_users_timeline` | read | optional | `get_users_timeline` |
| `mcp:list_broadcasts` | read | optional | `list_broadcasts` |
| `mcp:list_scheduled_broadcasts` | read | optional | `list_scheduled_broadcasts` |
| `mcp:list_scheduled_calls` | read | optional | `list_scheduled_calls` |
| `mcp:list_sources` | read | optional | `list_sources` |
| `mcp:search_communities` | read | optional | `search_communities` |
| `mcp:search_news` | read | optional | `search_news` |
| `mcp:search_posts_all` | read | optional | `search_posts_all` |
| `mcp:search_spaces` | read | optional | `search_spaces` |
| `mcp:search_users` | read | optional | `search_users` |
| `mcp:accept_chat_message_request` | write | optional | `accept_chat_message_request` |
| `mcp:archive_chat_conversation` | write | optional | `archive_chat_conversation` |
| `mcp:article_create_draft` | write | optional | `article_create_draft` |
| `mcp:chat_media_upload_append` | write | optional | `chat_media_upload_append` |
| `mcp:chat_media_upload_finalize` | write | optional | `chat_media_upload_finalize` |
| `mcp:chat_media_upload_initialize` | write | optional | `chat_media_upload_initialize` |
| `mcp:create_lists` | write | optional | `create_lists` |
| `mcp:create_source` | write | optional | `create_source` |
| `mcp:create_users_bookmark` | write | optional | `create_users_bookmark` |
| `mcp:create_users_bookmark_folder` | write | optional | `create_users_bookmark_folder` |
| `mcp:follow_list` | write | optional | `follow_list` |
| `mcp:get_chat_message_request` | write | optional | `get_chat_message_request` |
| `mcp:mark_chat_conversation_unread` | write | optional | `mark_chat_conversation_unread` |
| `mcp:media_upload` | write | optional | `media_upload` |
| `mcp:pin_list` | write | optional | `pin_list` |
| `mcp:unarchive_chat_conversation` | write | optional | `unarchive_chat_conversation` |
| `mcp:unfollow_list` | write | optional | `unfollow_list` |
| `mcp:unpin_list` | write | optional | `unpin_list` |
| `mcp:update_lists` | write | optional | `update_lists` |
| `mcp:update_source` | write | optional | `update_source` |
| `mcp:cancel_scheduled_call` | send | optional | `cancel_scheduled_call` |
| `mcp:create_posts` | send | optional | `create_posts` |
| `mcp:create_scheduled_broadcast` | send | optional | `create_scheduled_broadcast` |
| `mcp:go_live_scheduled_broadcast` | send | optional | `go_live_scheduled_broadcast` |
| `mcp:mark_chat_conversation_read` | send | optional | `mark_chat_conversation_read` |
| `mcp:respond_to_scheduled_call` | send | optional | `respond_to_scheduled_call` |
| `mcp:schedule_call` | send | optional | `schedule_call` |
| `mcp:send_chat_message` | send | optional | `send_chat_message` |
| `mcp:send_chat_typing_indicator` | send | optional | `send_chat_typing_indicator` |
| `mcp:update_scheduled_broadcast` | send | optional | `update_scheduled_broadcast` |
| `mcp:update_scheduled_call` | send | optional | `update_scheduled_call` |
| `mcp:delete_scheduled_broadcast` | delete | optional | `delete_scheduled_broadcast` |
| `mcp:delete_source` | delete | optional | `delete_source` |
| `mcp:delete_users_bookmark` | delete | optional | `delete_users_bookmark` |
| `mcp:remove_chat_moderator` | delete | optional | `remove_chat_moderator` |
| `mcp:remove_lists_member_by_user_id` | delete | optional | `remove_lists_member_by_user_id` |
| `mcp:chat_media_download` | export | optional | `chat_media_download` |
| `mcp:add_chat_moderator` | admin | optional | `add_chat_moderator` |
| `mcp:add_conversation_keys` | admin | optional | `add_conversation_keys` |
| `mcp:add_lists_member` | admin | optional | `add_lists_member` |
| `mcp:mute_broadcast_chat_user` | admin | optional | `mute_broadcast_chat_user` |
| `mcp:unmute_broadcast_chat_user` | admin | optional | `unmute_broadcast_chat_user` |
| `mcp:users_id_block` | admin | optional | `users_id_block` |
| `mcp:users_id_unblock` | admin | optional | `users_id_unblock` |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|
| `x.mentions` | events | `message` | `events_list` | billed |
| `x.bookmarks` | events | `bookmark` | `events_list` | billed |
| `x.timeline` | events | `message` | `events_list` | billed |

### Actions

None.

### Bus events

None.
<!-- /generated:capabilities -->

## The plugin's own methods

- **`status`** takes no account and makes no X read. It reports every alias, its sign-in state, the owner once a probe
  or a page answered, and the agents the generated access rules do not cover. A refused token refresh is `needs_sign_in`
  with a redacted reason.
- **`probe`** makes one billed `get_users_me` read and answers the account alias, the feed it was asked about and the
  owner (`x:@handle`). It reads no post, message or bookmark.
- **`events_list`** reads one feed per call: `mentions`, `bookmarks` or `timeline`. The source is fixed by the method's
  `source`; leaving it out reads mentions. The three sources are `x.mentions`, `x.bookmarks` and `x.timeline`.

## The three sources

All three are `kind: events`, read by `events_list`, in one service (`x.feeds`, shown as X). Every read is billed at
X's pay-per-use rates: the manifest declares $0.005 per post, $0.010 per author X includes and $0.010 per user an
identity read returns. Each page's `cost.units` holds the counts the call actually returned; `usd` is left out because
X reports no price of its own. `bookmarks` is private: it lists what the person saved, not what anyone else can see.

Events are normalised by the contract: a mention or a timeline post is `kind: message`, a bookmark is
`kind: bookmark` with `external_id` `bookmark:<post id>`; the author is an `x:@handle` actor, the thread is
`x-conversation:<conversation id>`, and the link is `https://x.com/i/status/<post id>`, on the declared `x.com` host.
Every event is `trust: "untrusted"`: X's text is data, never instructions.

## Pass-through tools

The manifest enumerates X's 101 MCP tools as `mcp:<tool>`, each with the inventory's class. They have no handler: the
vendor's MCP server owns them, and OpenCode names them `<server>_<tool>`, so the `default` alias's tool is `x_<tool>`
and `work`'s is `x-work_<tool>`. Code Mode shows them under the server's namespace, `tools.x.<tool>` and
`tools["x-work"].<tool>`. The manifest can name a tool OpenCode does not list for a token with fewer scopes; the plugin
never proxies or reimplements one.

Each source declares its X tools as bare operations: `get_users_me` and its feed's read. `probe` declares
`get_users_me`. A grant fence derives them per alias, as `x-work_get_users_mentions`, so one alias's grant never names
the other's tool. `events_list` itself declares no operations: one method reads three feeds, so the source's own
operations are the right granularity, and the vendor's per-tool rules still decide each inner call.

## No actions and no bus events

The plugin makes no write of its own: X's writes are its own MCP tools, declared `mcp:<tool>` and run by the vendor's
server, so the plugin has no plan/commit pair to offer as an `actions` entry. For the same reason it declares no bus
events: `changed` is emitted after a write the plugin itself makes or a webhook it receives, and the plugin does neither.
Pull is the truth here; a person or an automation re-reads a source through `events_list` with its cursor.

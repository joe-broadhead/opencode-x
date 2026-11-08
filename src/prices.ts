/**
 * X's pay-per-usage rates, as published at
 * https://docs.x.com/x-api/getting-started/pricing (read 2026-11-08). A method with no row is refused by the script
 * path with X_PRICE_UNKNOWN rather than run for free.
 */
export const PRICE_SOURCE = "https://docs.x.com/x-api/getting-started/pricing"
export const PRICE_AS_OF = "2026-11-08"

export type ResourceKind = "post" | "user" | "owned" | "list" | "space" | "community" | "news" | "dm"

export type MethodPrice =
  | { readonly kind: ResourceKind; readonly perResourceUsd: number }
  | { readonly kind: "request"; readonly perRequestUsd: number }
  | { readonly kind: "postCreate"; readonly perRequestUsd: number; readonly withUrlUsd: number }

const resource = (kind: ResourceKind, perResourceUsd: number): MethodPrice => ({ kind, perResourceUsd })
const request = (perRequestUsd: number): MethodPrice => ({ kind: "request", perRequestUsd })

const POST = resource("post", 0.005)
const USER = resource("user", 0.01)
const OWNED = resource("owned", 0.001)
const LIST = resource("list", 0.005)
const SPACE = resource("space", 0.005)
const COMMUNITY = resource("community", 0.005)
const NEWS = resource("news", 0.005)
const DM = resource("dm", 0.01)

/** The table, one row per known method. Unknown keys are refused, never free. */
export const PRICES: Readonly<Record<string, MethodPrice>> = {
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
  get_users_mentions: OWNED,
  get_users_posts: OWNED,
  get_users_liked_posts: OWNED,
  get_users_bookmarks: OWNED,
  get_users_bookmarks_by_folder_id: OWNED,
  get_users_bookmark_folders: OWNED,
  get_users_me_followers: OWNED,
  get_users_me_following: OWNED,
  get_users_blocking: OWNED,
  get_users_owned_lists: OWNED,
  get_users_followed_lists: OWNED,
  get_users_list_memberships: OWNED,
  get_users_pinned_lists: OWNED,
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
  get_posts_counts_recent: request(0.005),
  get_trends_by_woeid: request(0.01),
  get_source: request(0.005),
  list_sources: request(0.005),
  get_users_public_key: request(0.005),
  get_users_public_keys: request(0.005),
  get_usage_credits: request(0),
  // Writes.
  article_create_draft: request(0.005),
  create_lists: request(0.01),
  create_users_bookmark: request(0.005),
  create_users_bookmark_folder: request(0.005),
  delete_users_bookmark: request(0.005),
  pin_list: request(0.005),
  unpin_list: request(0.005),
  update_lists: request(0.005),
  create_posts: { kind: "postCreate", perRequestUsd: 0.015, withUrlUsd: 0.2 },
  // The off tools, priced by the published category they belong to, for an agent that allows one.
  follow_list: request(0.015),
  unfollow_list: request(0.015),
  users_id_block: request(0.015),
  users_id_unblock: request(0.015),
  add_lists_member: request(0.005),
  remove_lists_member_by_user_id: request(0.005),
  accept_chat_message_request: request(0.015),
  add_chat_moderator: request(0.015),
  remove_chat_moderator: request(0.015),
  archive_chat_conversation: request(0.015),
  unarchive_chat_conversation: request(0.015),
  mark_chat_conversation_read: request(0.015),
  mark_chat_conversation_unread: request(0.015),
  send_chat_message: request(0.015),
  send_chat_typing_indicator: request(0.015),
  mute_broadcast_chat_user: request(0.001),
  unmute_broadcast_chat_user: request(0.001),
  cancel_scheduled_call: request(0.015),
  respond_to_scheduled_call: request(0.015),
  schedule_call: request(0.015),
  create_scheduled_broadcast: request(0.005),
  delete_scheduled_broadcast: request(0.005),
  update_scheduled_broadcast: request(0.005),
  update_scheduled_call: request(0.015),
  create_source: request(0.005),
  delete_source: request(0.005),
  update_source: request(0.005),
  go_live_scheduled_broadcast: request(0.005),
  chat_media_download: request(0.005),
  chat_media_upload_append: request(0.005),
  chat_media_upload_finalize: request(0.005),
  chat_media_upload_initialize: request(0.005),
  add_conversation_keys: request(0.015),
}

/** The method's published price, or undefined when the table has no row. */
export const priceOf = (method: string): MethodPrice | undefined => PRICES[method]

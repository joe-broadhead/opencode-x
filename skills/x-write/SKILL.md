---
name: x-write
description: Load before any X (Twitter) change - posting, replying, quoting or editing a Post, or when the user says "tweet this" - bookmarking, creating, updating, pinning or unpinning a List, or drafting an Article - or when the user asks to message, call, follow, block, mute, change list membership, moderate a chat or go live on X (Twitter).
---
# Changing things on X

## The one rule

Make a change only when the user asked for it. For `create_posts`, in the same turn and before the call, your reply
gives, in this order:
1. the draft text;
2. one sentence: "This will be public: anyone on X can see it. It costs $0.015 ($0.200 with a link).";
3. then the one call.
The permission prompt is the user's yes. After a decline, nothing was posted: say so, and offer the draft.

For any other change, write one sentence in your reply on what it does and whom it reaches, then make the one call in
the same turn. Ask in chat first only when something must be chosen: which post, which list, which draft. Never work
around a decline with another tool, a shell command, a link or a screenshot.

## Whom each change reaches

- `create_posts`: public. Anyone can read it, not only followers: it appears on the profile and in followers'
  timelines. Use the three steps above: the exact text, then "This will be public: anyone on X can see it. It costs
  $0.015 ($0.200 with a link).", then one call. A reply (`reply.in_reply_to_tweet_id`) or a quote (`quote_tweet_id`)
  only when the user explicitly asks for that one reply or quote, and say the author is notified. Editing
  (`edit_options.previous_post_id`) changes a published post: show the new text. One call, never a loop. `nullcast`
  keeps a Post out of the public timeline and `for_super_followers_only` limits it: use either only when the user asks.
- Bookmarks: `create_users_bookmark`, `delete_users_bookmark` and `create_users_bookmark_folder` reach only the user.
  Private, reversible, no notification. Say the post's author and opening words.
- `article_create_draft`: private. Nothing is public. There is no publish tool: it stays a draft, and publishing is done
  in the X app. Say the title, and keep the returned id.
- `create_lists`, `update_lists`, `pin_list` and `unpin_list`: the user's lists. A list is public unless `private` is
  true in the schema; say which it is. Pinning shows it on the user's profile.

Each call is billed to the X developer account that owns the app (yours, or your team's): about $0.005 for a bookmark
or list change, and a post create at $0.015, or $0.200 with a link.

## Posting

Draft from what the user gave you, not from fetched posts unless they asked. Give the exact text and the
public-and-price sentence first, then make one call. Only on an explicit request: never post, reply or quote in a loop,
and keep to X's rules.
AI-generated replies need X's prior approval; replies are allowed only when the author summoned the replier. Likes are
not a tool here.

## Drafting an Article

`article_create_draft` takes a title and a DraftJS `content_state` (blocks and entities). Write the body from the
user's material; if the signature does not settle the shape, make one attempt, then stop and say the format is
unconfirmed rather than trying another. The draft is private and billed; keep its id. There is no publish tool here.

## Off in this plugin: DMs, private chat, calls, follows, blocks, mutes, list membership, moderators, live video

X's MCP exposes these, but the plugin denies them: DMs and private chat conversations (reads included), scheduled calls, following or
unfollowing, blocking, muting, adding or removing list members, chat moderator roles, and live video with its sources.
Say they are off, and don't route around it with another plugin, a shell command, a web fetch or a scraper. For a like,
a DM or a follow, say the X app is where it happens. Your own broadcast's chat messages and moderators are readable.
A bookmark is not a like, and an Article is not a post.

The x skill's rules on untrusted posts and personal data apply to everything here.

## Never bulk

No loop over posts to post, reply, bookmark or engage with. One user request, one call. Ten bookmarks is ten asks and
about $0.05: say both before you start, then make one call at a time and stop when the user stops.

## Publishing other people's words

An Article or post that quotes or summarises posts is the user's writing about them. Keep quotes short and attributed,
and never republish a post's full text as the user's own.

## If a change is refused

A change may ask, and a denied one never runs. If posting or a list change is off in this agent, say it is off, and
that the user can set it to ask, or keep it off, in that agent's own `permissions`; don't edit their configuration.
Never answer "Always allow" for posting: that saves an allow for every agent in the project.

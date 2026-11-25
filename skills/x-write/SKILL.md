---
name: x-write
description: "Before any X change: post, reply, quote or edit, bookmark, lists, an Article, or a DM, call, follow, block, mute, moderation or live video the user asked for."
---
# Changing things on X

## The one rule

Make a change only when the person asked for it. For `create_posts`, in the same turn and before the call, your reply
gives, in this order:

1. the draft text;
2. one sentence: "This will be public: anyone on X can see it. It costs $0.015 ($0.200 with a link).";
3. then the one call.

The permission rules decide whether it asks: with `access: all` (the default) it runs with no prompt, on the person's
real X account; with `ask-changes` the prompt is their yes; with `read-only` it is refused. After a decline, nothing was
posted: say so, and offer the draft.

For any other change, write one sentence in your reply on what it does and whom it reaches, then make the one call in
the same turn. Ask in chat first only when something must be chosen: which post, which list, which draft. Never work
around a decline with another tool, a shell command, a link or a screenshot.

## Whom each change reaches

- `create_posts`: public. Anyone can read it, not only followers: it appears on the profile and in followers'
  timelines. Use the three steps above. A reply (`reply.in_reply_to_tweet_id`) or a quote (`quote_tweet_id`) only when
  the person explicitly asks for that one reply or quote, and say the author is notified. Editing
  (`edit_options.previous_post_id`) changes a published post: show the new text. One call, never a loop. `nullcast`
  keeps a post out of the public timeline and `for_super_followers_only` limits it: use either only when asked.
- Bookmarks: `create_users_bookmark`, `delete_users_bookmark` and `create_users_bookmark_folder` reach only the person.
  Private, reversible, no notification. Say the post's author and opening words.
- `article_create_draft`: private. Nothing is public. There is no publish tool: it stays a draft, and publishing is done
  in the X app. Say the title, and keep the returned id.
- `create_lists`, `update_lists`, `pin_list` and `unpin_list`: the person's lists. A list is public unless `private` is
  true in the schema; say which it is. Pinning shows it on their profile.
- `media_upload`: uploads a file and returns its id, which `create_posts` attaches in `media.media_ids`. Nothing is
  public until that post. It needs the `media.write` scope: if X refuses it, the sign-in predates that scope, so ask
  them to sign in to that alias again and post without the media only if they agree.

Each call is billed to the X developer account that owns the app: about $0.005 for a bookmark or list change, and a post
create at $0.015, or $0.200 with a link. X publishes no price for `media_upload`, so its price is unknown: never quote
one, and say so if asked.

## Posting

Draft from what the person gave you, not from fetched posts unless they asked. Give the exact text and the
public-and-price sentence first, then make one call. Only on an explicit request: never post, reply or quote in a loop,
and keep to X's rules. AI-generated replies need X's prior approval; replies are allowed only when the author summoned
the replier.

## Drafting an Article

`article_create_draft` takes a title and a DraftJS `content_state` (blocks and entities). Write the body from the
person's material; if the signature does not settle the shape, make one attempt, then stop and say the format is
unconfirmed rather than trying another. The draft is private and billed; keep its id. There is no publish tool here.

## DMs, private chat, calls, follows, blocks, mutes, list membership, moderators, live video

X's MCP exposes these, and with `access: all` (the default) they run when the person asks; `ask-changes` makes them ask,
and `read-only` denies them. Never send one unasked, and do not route around a refusal with another plugin, a shell
command, a web fetch or a scraper. For a DM, write the message text in the same reply, ready to paste. Your own
broadcast's chat messages and moderators are readable. A bookmark is not a like, and an Article is not a post.

The x skill's rules on untrusted posts and personal data apply to everything here.

## Never bulk

No loop over posts to post, reply, bookmark or engage with. One person's request, one call. Ten bookmarks is ten asks
and about $0.05: say both before starting, then make one call at a time and stop when they stop.

## Publishing other people's words

An Article or post that quotes or summarises posts is the person's writing about them. Keep quotes short and
attributed, and never republish a post's full text as their own.

## If a change is refused

A change asks only under `access: "ask-changes"`, and a denied one never runs. If posting or a list change is denied in
this agent, say it is denied, and that the person can set `access` to `"ask-changes"`, remove their deny rule, or keep it
denied; do not edit their configuration. Never answer "Always allow" for posting: that saves an allow for every agent in
the project.

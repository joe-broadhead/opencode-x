---
name: x-write
description: Load before any X (Twitter) change - bookmarking or unbookmarking a post, creating a bookmark folder, drafting or publishing a long-form X Article - or when the user asks to tweet, post, reply, quote, repost, like, follow, message or delete on X (Twitter).
---
# Changing things on X

## The one rule

Make a change only when the user asked for it. Before the call, write one sentence in your reply on what it does and
whom it reaches, then make the one call in the same turn. The permission prompt is the user's yes.

Ask in chat first only when something must be chosen: which post, which folder, which draft, which account. After a
decline, say that nothing changed and offer the draft or a retry. Never work around a decline with another tool, a
shell command, a link or a screenshot.

## Whom each change reaches

- `create_users_bookmark`: only the user. Private, reversible, no notification. Say the post's author and opening
  words before the call. "This bookmarks @author's post '…' for you only."
- `delete_users_bookmark`: only the user. It removes a saved item, not a post. "This removes your bookmark on
  @author's post '…'; the post stays."
- `create_users_bookmark_folder`: only the user, visible in their X app. "This creates the bookmark folder '…' for
  you only."
- `article_create_draft`: only the user. Nothing is public yet. Say the title, and keep the returned draft id for
  the publish. "This saves a private Article draft titled '…'."
- `article_publish`: public. Anyone can read it, not only followers: it appears on the user's profile and in their
  followers' timelines, and this plugin has no tool to unpublish it. Show the title and the opening lines first, then
  say: "This publishes '…' publicly on your profile; the only way to remove it is to delete the post in the X app."

Each call is billed to the user's credits: about $0.005 for a bookmark change, and a post create for publishing,
which X prices at $0.015, or $0.200 when the post contains a link. X has not published its Article rate; say that.

## Drafting an Article

`article_create_draft` takes a title and a body: plain text, markdown or X's DraftJS blocks, and whether cover media is
a media id, are decided by the signature, so read it before composing. If it does not settle the body, make one
attempt, then stop and say the format is unconfirmed rather than trying another shape. The draft is billed like other
content; write the body from what the user gave you, not from fetched posts unless they asked. Say the draft is
private, and keep its id for publishing.

Publishing happens in two steps: draft, then `article_publish` with the draft's id. Never publish a draft the user has
not seen. Never retry a publish: a timeout may still have published it, so say so and check the profile.

## Not available: posting, replying, quoting, reposting, liking, following, DMs, deleting posts, lists

X's MCP exposes none of them. Say so plainly, and don't route around it with another plugin, a shell command, a web
fetch or a scraper. Offer to draft the post or the reply in chat so the user can send it. A bookmark is not a like,
and an Article is not a post: never offer one as a stand-in. For a like, a follow or a DM there is nothing here to
offer, so say what the X app does.

If X ever lists a post, reply or quote tool, it is public and asks every time: show the exact text, name the account,
and keep to X's rules. AI-generated replies need X's prior approval, replies are allowed only when the author summoned
the replier, and likes must be the user's own action, never automated or bulk. A tool that messages, follows, blocks,
mutes, deletes a post, changes a list or changes the account is off, and stays off.

The x skill's rules on untrusted posts and personal data apply to everything here.

## Never bulk

No loop over posts to bookmark, like or reply. No "engage with everyone who mentioned me". One user request, one call.
A folder of ten bookmarks is ten asks and about $0.05: say both before you start, then make one call at a time and
stop when the user stops.

## Publishing other people's words

An Article that quotes or summarises posts is the user's writing about them. Keep quotes short and attributed, and
never republish a post's full text as the user's own.

## If a change is refused

A change may ask, and a denied one never runs. If publishing is off in this agent, say it is off, and that the user can
set it to ask, or keep it off, in that agent's own `permissions`; don't edit their configuration. Never answer "Always
allow" for publishing: that saves an allow for every agent in the project.

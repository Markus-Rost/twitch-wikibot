# [WikiBot](https://www.twitch.tv/WikiBot)
**WikiBot** is a [Twitch](https://www.twitch.tv/) chat bot with the purpose to easily link to Gamepedia and Fandom wikis.
He always searches for the best result for the provided search term. He is able resolve redirects and follow interwiki links.

### WikiBot is not affiliated with Curse/Gamepedia/Fandom/Wikia and is an unofficial tool!

Twitch channel: [https://www.twitch.tv/WikiBot](https://www.twitch.tv/WikiBot)
<br>Support server: [https://discord.gg/v77RTk5](https://discord.gg/v77RTk5)

# Commands
### `!wiki <search term>`
**WikiBot** will answer with a link to a matching article in the default wiki.

### `!wiki !<wiki> <search term>`
**WikiBot** will answer with a link to a matching article in the named Gamepedia wiki: `https://<wiki>.gamepedia.com/`

### `!wiki ?<wiki> <search term>`
**WikiBot** will answer with a link to a matching article in the named Fandom wiki: `https://<wiki>.fandom.com/`

### `!wiki ??<wiki> <search term>`
**WikiBot** will answer with a link to a matching article in the named Wikia wiki: `https://<wiki>.wikia.org/`

### `!wiki setwiki <link>`
**WikiBot** will change the default wiki for the stream.
<br>*Streamer and mods only*

### `!wiki setwiki --auto`
**WikiBot** will automatically change the default wiki for the stream whenever the game is updated.
<br>An automatically set wiki can be overwritten by `!wiki setwiki <link>`.
<br>Use the command again to toggle the feature.
<br>*Streamer and mods only*

### `!wiki join @<your name>`
**WikiBot** will join your stream chat.

### `!wiki leave @<your name>`
**WikiBot** will leave your stream chat.
<br>*Can only be used on your own stream.*

### `[[<page name>]]`
**WikiBot** will answer with the link without description.

### `{{<page name>}}`
**WikiBot** will answer with the link with description.

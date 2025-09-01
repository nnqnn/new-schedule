![Sirinium](https://i.imgur.com/Z2vcIbf.png)
## Installation
``yarn add perovxp/sirinium``
## Usage
```javascript
const sirinium = require("sirinium");

const client = new sirinium.Client();
await client.getInitialData(); // Required

await client.changeWeek(1); // Add 1 week

const schedule = await client.getGroupSchedule("К0609-24");
```
## How it works
Module emulates user interactions with schedule. Written using reverse engineering tricks.
## License
MIT Licensed
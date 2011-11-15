var fs = require ('fs')
exports.settings = JSON.parse(fs.readFileSync("settings.json"))
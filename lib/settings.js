var fs = require('fs')
var os = require('os')

module.exports = (function(major_version){
  try {
    var settings = JSON.parse(fs.readFileSync("settings.json"))
    settings.api.major_version = major_version
    try {settings.api.minor_version = fs.readFileSync('version').toString().trim() } catch(e) {}
    settings.api.version = settings.api.major_version+"-"+settings.api.minor_version
    if(!settings.api.hostname){settings.api.hostname = os.hostname()}
    return settings
  } catch(e) {
    if(e.code == "ENOENT") {
      var sample = fs.readFileSync("settings.json.sample")
      fs.writeFileSync("settings.json", sample)
      console.log(process.cwd()+"/settings.json file has been created. Please edit this and restart.")
    } else {
      console.log("Unknown error loading settings.json")
    }
    process.exit(1)
  }
})
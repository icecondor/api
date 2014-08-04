var fs = require ('fs')
module.exports = (function(){
  try {
    return JSON.parse(fs.readFileSync("settings.json"))
  } catch(e) {
    if(e.code == "ENOENT") {
      var sample = fs.readFileSync("settings.json.sample")
      fs.writeFileSync("settings.json", sample)
      console.log("An example settings.json file has been created. Please edit this and restart.")
      process.exit(1)
    }
  }
})()
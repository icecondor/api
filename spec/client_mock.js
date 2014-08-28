  module.exports = function(){
    var journal = []
    return {socket: {write: function(str){journal.push(str)},
                     last: function(){return JSON.parse(journal[0])}
                    }
           }
  }


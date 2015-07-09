// Filename: app.js

var EVENTBRITE_CLIENT_ID = '';
var EVENTBRITE_CLIENT_SECRET = '';
var SENDGRID_USERNAME = '';
var SENDGRID_FROM = '';
var SENDGRID_PASSWORD = '';
var ADDRESS = '';
var PORT = 8080;
var CHECK_INTERVAL = 60000; // How often (in milliconds) to check for subscriptions to process.
var EMAIL_INTERVAL = 24*60*60000; // How many milliseconds between emails?

var express = require('express');
var bodyParser = require('body-parser');
var url = require('url');
var session = require('express-session');
var cookieParser = require('cookie-parser');
var request = require('request');
var sendgrid = require('sendgrid')(SENDGRID_USERNAME, SENDGRID_PASSWORD);

var mongoose = require('mongoose');
mongoose.connect('mongodb://127.0.0.1:27017/test');

var app = express();

var Subscription = mongoose.model('Subscriptions', {
  email: String,
  token: String,
  location: String,
  next: Number
});

app.use(bodyParser.json());
app.use(cookieParser());
app.use(session({
  secret: '1234567890QWERTY'
}))

function searchEvents(params, callback) {
  request({
      url: 'https://www.eventbriteapi.com/v3/events/search/',
      qs: params,
      method: 'GET',
    },
    function(err, response, body) {
      if(err || response.statusCode != 200) {
        callback('Unable to authenticate with Eventbrite.');
        return;
      } else {
        var js = JSON.parse(body);
        var events = [];

        for(var i in js.events)
        {
          events.push({
            title: js.events[i].name.text, 
            start: js.events[i].start.local, 
            end: js.events[i].end.local,
            url: js.events[i].url
          });
        }

        callback(null, events);
      }
  });
}

function sendEmail(email, subject, content)
{
  try {
    sendgrid.send({
      to: email,
      from: SENDGRID_FROM,
      subject: subject,
      text: content
    }, function(err, json) {
      if(err) 
        console.log(err);
    });
  } catch(e) {
    console.log(e);
  }
}

app.get('/oauth', function(req, res) {
  res.redirect('https://www.eventbrite.com/oauth/authorize?response_type=code&client_id='+EVENTBRITE_CLIENT_ID);
});

app.get('/oauth_callback', function(req, res) {
  var query = url.parse(req.url, true).query;

  req.session.access_token = query.code;

  var form = {
    client_id: EVENTBRITE_CLIENT_ID,
    code: query.code,
    client_secret: EVENTBRITE_CLIENT_SECRET,
    grant_type: 'authorization_code'
  }

  request({
      url: 'https://www.eventbrite.com/oauth/token',
      headers: {
        'Content-type': 'application/x-www-form-urlencoded'
      },
      form: form,
      method: 'POST',
    },
    function(err, response, body) {
      if(err || response.statusCode != 200) {
        res.send('Unable to authenticate with Eventbrite.');
      } else {
        var js = JSON.parse(body);

        req.session.access_token = js.access_token;
        res.redirect('/');
      }
  });
});

app.get('/api/me', function(req, res) {
  if(!req.session.access_token) {
    res.send({error: 'Not logged in'});
    return;
  }

  request({
      url: 'https://www.eventbriteapi.com/v3/users/me/?token='+req.session.access_token,
      method: 'GET',
    },
    function(err, response, body) {
      if(err || response.statusCode != 200) {
        res.send('Unable to get user info with Eventbrite.');
      } else {
        var js = JSON.parse(body);

        var userInfo = {};
        for(var i in js.emails) {
          if(js.emails[i].primary) {
            userInfo.email = js.emails[i].email;
          }
        }

        userInfo.name = js.name;
        res.send(userInfo);
      }
  });
});

app.get('/logout', function(req, res) {
  req.session.destroy();
  res.redirect('/');
});

app.get('/api/events', function(req, res) {
  if(!req.session.access_token) {
    res.send({error: 'Not logged in'});
    return;
  }

  var query = url.parse(req.url, true).query;
  var location = query.location;

  var qs = {
    token: req.session.access_token,
    q: 'hackathon',
    'location.address': location,
    'location.within': '75mi',
    sort_by: 'date',
    price: 'free'
    //'date_created.keyword': 'this_week'
  };

  searchEvents(qs, function(err, events) {
    if(err) {
      res.send({error: 'Unable to authenticate with Eventbrite.'});
      return;
    } else {
      res.send(events);
    }
  });
  
})

app.post('/api/subscribe', function(req, res) {
  if(!req.session.access_token) {
    res.send({error: 'Not logged in'});
    return;
  }

  var timeNow = new Date();
  
  Subscription.create({
    email: req.body.email, 
    location: req.body.location, 
    next: timeNow.getTime(),
    token: req.session.access_token
  }, function(error, doc) {
    if(error) {
      res.send({error: 'Unable to subscribe'});
      return;
    }

    res.send({location: doc.location});
  });
});

app.get('/unsubscribe', function(req, res) {
  var query = url.parse(req.url, true).query;

  Subscription.remove({_id: query.subscriptionid}, function(error, numAffected) {
    if(error || numAffected.result.ok != 1) {
      res.send('Could not unsubscribe');
    } else {
      res.send('Unsubscribed');
    }
  });
});

setInterval(function() {
  var qs = {
    q: 'hackathon',
    sort_by: 'date',
    price: 'free'
    // 'date_created.keyword': 'this_week'    
  };

  var timeNow = new Date();

  Subscription.find({next: {$lt: timeNow.getTime()}}, function(error, subscriptions) {
    for(var i in subscriptions) {
      qs['location.address'] = subscriptions[i].location;
      qs['location.within'] = '75mi';
      qs.token = subscriptions[i].token;

      var sub = subscriptions[i];
      searchEvents(qs, function(err, events) {
        if(err) {
          console.log(err);
          return;
        }

        Subscription.update({_id: sub._id}, {next: timeNow.getTime()+EMAIL_INTERVAL}, function(err, numAffected) {
          if(err) {
            console.log(err);
            return;
          }          
        });

        if(events.length == 0) {
          return;
        }

        var content = '';
        for(var i in events) {
          content += events[i].title+"\n"+events[i].start.substring(0, 10)+" - "+events[i].end.substring(0, 10)+"\n"+events[i].url+"\n\n";
        }

        content += 'Unsubscribe at: '+ADDRESS+':'+PORT+'/unsubscribe?subscriptionid='+sub._id;

        sendEmail(sub.email, 'New hackathons', content);
      }); 
    }
  });
}, CHECK_INTERVAL);

app.listen(PORT);

app.use(express.static(__dirname + '/public'));

console.log('Application listening on port '+PORT);
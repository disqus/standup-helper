// express
var express = require('express');
var bodyParser = require('body-parser');
var app = express();
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// server includes
var slackbot = require('./server/slackbot');

// view logic
var dashboard = require('./server/dashboard');

// DB setup
var Sequelize = require('sequelize');
var Standup, Users, Boards;
var sequelize = new Sequelize(process.env.DB, process.env.DB_USER, process.env.DB_PASS, {
  host: '0.0.0.0',
  dialect: 'postgres',
  pool: {
    max: 5,
    min: 0,
    idle: 10000
  },
  logging: false
});

// authenticate with the database
sequelize.authenticate()
  .then(function(err) {
    Standup = sequelize.define('standups', {
      data: {
        type: Sequelize.TEXT
      },
      date: {
        type: Sequelize.TEXT
      },
    });
    // Users = sequelize.define('users', {
    Users = sequelize.define('prod_users', {
        name: {
            type: Sequelize.TEXT,
            primaryKey: true
        },
        trello: {
            type: Sequelize.TEXT,
            unique: true
        },
        slack: {
            type: Sequelize.TEXT,
            unique: true
        },
        phab: {
            type: Sequelize.TEXT,
            unique: true
        }
    });
    Boards = sequelize.define('boards', {
        id: {
            type: Sequelize.TEXT,
            primaryKey: true
        },
        name: {type: Sequelize.TEXT},
        emoji: {type: Sequelize.TEXT}
    });
  })
  .catch(function (err) {
    console.log('Unable to connect to the database: ', err);
  });

// API - Slackbot Endpoints
app.post('/s/', (req, res) => {slackbot.beginStandup(req, res, Standup, Users, Boards)});
app.post('/m/', (req, res) => {slackbot.messageLogger(req, res, Standup, Users)});
app.post('/b/', (req, res) => {slackbot.responseHandler(req, res, Standup, Users)});

// API - Standup View Endpoints
app.get('/v', (req, res) => {dashboard.returnStandupData(req, res, Standup)});
app.get('/u', (req, res) => {dashboard.returnUserList(req, res, Users)});
app.get('/d', (req, res) => {dashboard.returnDiffs(req, res, Users)});
app.get('/t', (req, res) => {dashboard.returnTimeOff(req, res, Users)});
// Views
app.get('/view/', (req, res) => {res.sendFile(__dirname + '/views/standup.html')});
app.get('/foo/', (req, res) => {res.send('bar')});

// Reset standups DB
app.get('/resetdb/', function (req, res) {
  // using 'force' it drops the table users if it already exists, and creates a new one
  Standup.sync({force: true})
    .then(function(){
        res.send('Database Reset.');
    });
});

// Listen for requests
var listener = app.listen(process.env.PORT, function () {
  console.log('Your app is listening on port ' + listener.address().port);
});



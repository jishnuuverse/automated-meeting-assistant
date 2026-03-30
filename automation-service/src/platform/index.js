'use strict';

module.exports = {
  ...require('./detectPlatform'),
  ...require('./adapterFactory'),
  BaseAdapter: require('./BaseAdapter'),
  GoogleMeetAdapter: require('./GoogleMeetAdapter'),
  ZoomAdapter: require('./ZoomAdapter'),
  TeamsAdapter: require('./TeamsAdapter'),
};

// Filename: public/hackathonfinder.js

angular.module('HackathonFinderApp', [])
.controller('HackathonFinderCtrl', ['$scope', '$http', function($scope, $http) {

  $http.get('/api/me').then(function(response) {
    $scope.doneLoading = true;
    $scope.location = '';

    if(response.data.error) {
      $scope.isLoggedIn = false;
      return;
    }

    $scope.email = response.data.email;
    $scope.name = response.data.name;
    $scope.isLoggedIn = true;
  });

  $scope.findEvents = function() {
    $http.get('/api/events?location='+$scope.location).then(function(response) {
      if(response.data.error) {
        alert('Error: '+response.data.error);
        return;
      }

      $scope.events = response.data;
    });
  }

  $scope.subscribe = function() {
    $http.post('/api/subscribe', {location: $scope.location, email: $scope.email}).then(function(response) {
      if(response.data.error) {
        alert('Error: '+response.data.error);
        return;
      }

      alert('You are now subscribed to hackathons near '+$scope.location);
    });
  }
}]);
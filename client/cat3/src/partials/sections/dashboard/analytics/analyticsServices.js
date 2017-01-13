(function (angular) {
    "use strict";
    angular.module('apis.analytics',[])
        .factory('analyticsServices',['$rootScope','$state', function ($rootScope,$state) {
            return {
                initFilter:function(){
                    $rootScope.organNewEnt=[];
                    $rootScope.filterNewEnt={};
                    $rootScope.organNewEnt.org = '0';
                    $rootScope.filterNewEnt.period='month';
                    $rootScope.splitUpCosts=[];
                    $rootScope.filterNewEnt.platformId=[];
                    var months=['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                    $rootScope.filterNewEnt.endDate={
                        year:'2017',
                        week:'1st',
                        month:months[new Date().getMonth()],
                        day:moment(new Date()).format('YYYY-MM-DD')
                    };
                    $rootScope.filterNewEnt.date= $rootScope.filterNewEnt.endDate.month+' '+ $rootScope.filterNewEnt.endDate.year;
                },
                applyFilter : function(filterApp,period){
                    $rootScope.filterNewEnt.date= $rootScope.filterNewEnt.endDate.month+' '+ $rootScope.filterNewEnt.endDate.year;
                    if($rootScope.organObject) {
                        var obj = $rootScope.organObject,
                            or = $rootScope.organNewEnt.org,
                            bu = $rootScope.organNewEnt.buss,
                            pr = $rootScope.organNewEnt.proj;
                        if (period) {
                            if (period === 'day'){
                                $rootScope.filterNewEnt.date= $rootScope.filterNewEnt.endDate.day;
                            } else {
                                $rootScope.filterNewEnt.date= $rootScope.filterNewEnt.endDate.month+' '+ $rootScope.filterNewEnt.endDate.year;
                            }
                            $rootScope.filterNewEnt.period = period;
                        }

                        if (or) {
                            $rootScope.filterNewEnt.org = {name: obj[or].name, id: obj[or].rowid, title: 'ORG'};
                            $rootScope.filterNewEnt.provider = '';
                        } else{
                            $rootScope.filterNewEnt.org = {id: obj[or].rowid, title: 'ORG'};
                        }
                        if (filterApp) {
                            if (bu) {
                                $rootScope.filterNewEnt.buss = {
                                    name: obj[or].businessGroups[bu].name,
                                    id: obj[or].businessGroups[bu].rowid,
                                    title: 'BU'
                                };
                            }
                            if (pr) {
                                $rootScope.filterNewEnt.proj = {
                                    name: obj[or].businessGroups[bu].projects[pr].name,
                                    id: obj[or].businessGroups[bu].projects[pr].rowid,
                                    title: 'Project'
                                };
                            }
                             if($rootScope.organNewEnt.instanceType)  {
                                 $rootScope.filterNewEnt.instanceType = {
                                     name: $rootScope.organNewEnt.instanceType,
                                     id: $rootScope.organNewEnt.instanceType,
                                     title: 'Instance'
                                 };
                             } else {
                                 $rootScope.filterNewEnt.instanceType = {};
                             }
                            if ($rootScope.organNewEnt.provider) {
                                $rootScope.filterNewEnt.provider = {
                                    name: $rootScope.providers[$rootScope.organNewEnt.provider].providerName,
                                    id: $rootScope.providers[$rootScope.organNewEnt.provider]._id,
                                    title: 'Provider'
                                };
                            } else {
                                $rootScope.filterNewEnt.provider = '';
                            }
                        } else {
                            $rootScope.organNewEnt = {};
                            if($state.current.name === "dashboard.analytics.usage"){
                                $rootScope.organNewEnt.provider='0';
                                $rootScope.organNewEnt.instanceType='Unassigned';
                                $rootScope.$emit('INI_usage', 'Unassigned');
                            }
                            $rootScope.organNewEnt.org = or;
                        }
                    }
                    return 1;
                }
            };
        }]);
})(angular);
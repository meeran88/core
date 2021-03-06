
var logger = require('_pr/logger')(module);
var CatalystCronJob = require('_pr/cronjobs/CatalystCronJob');
var AWSProvider = require('_pr/model/classes/masters/cloudprovider/awsCloudProvider.js');
var MasterUtils = require('_pr/lib/utils/masterUtil.js');
var async = require('async');
var resourceService = require('_pr/services/resourceService');
var instanceService = require('_pr/services/instanceService');
var tagsModel = require('_pr/model/tags');
var unassignedInstancesModel = require('_pr/model/unassigned-instances');
var instancesDao = require('_pr/model/classes/instance/instance');
var assignedInstancesDao = require('_pr/model/unmanaged-instance');
var logsDao = require('_pr/model/dao/logsdao.js');
var instanceLogModel = require('_pr/model/log-trail/instanceLog.js');


var AWSProviderSync = Object.create(CatalystCronJob);
AWSProviderSync.execute = awsProviderSync;

module.exports = AWSProviderSync;

function awsProviderSync() {
    MasterUtils.getAllActiveOrg(function(err, orgs) {
        if(err) {
            logger.error(err);
        }else if(orgs.length > 0){
            for(var i = 0; i < orgs.length; i++){
                (function(org){
                    AWSProvider.getAWSProvidersByOrgId(org.rowid, function(err, providers) {
                        if(err) {
                            logger.error(err);
                            return;
                        } else if(providers.length > 0){
                            var count = 0;
                            for(var j = 0; j < providers.length; j++){
                                (function(provider){
                                    count++;
                                    awsProviderSyncForProvider(provider,org.orgname)
                                })(providers[j]);
                            }
                            if(count ===providers.length){
                                return;
                            }
                        }else{
                            logger.info("Please configure Provider in Organization " +org.orgname+" for EC2 Provider Sync");
                            return;
                        }
                    });
                })(orgs[i]);
            }
        }else{
            logger.info("Please configure Organization for EC2 Provider Sync");
            return;
        }
    });
}

function awsProviderSyncForProvider(provider,orgName) {
    logger.info("EC2 Data Fetching started for Provider "+provider.providerName);
    async.waterfall([
        function (next) {
            resourceService.getEC2InstancesInfo(provider,orgName, next);
        },
        function (instances, next) {
            saveEC2Data(instances,provider, next);
        },
        function(instances,next){
            async.parallel({
                instanceSync: function(callback){
                    instanceSyncWithAWS(instances,provider._id,callback);
                },
                assignedInstance: function(callback){
                    async.waterfall([
                        function(next){
                            unassignedInstancesModel.getUnAssignedInstancesByProviderId(provider._id,next)
                        },
                        function(unassignedInstances,next){
                            tagMappingForInstances(unassignedInstances,provider,next);
                        },
                        function(assignedInstances,next){
                            saveAssignedInstances(assignedInstances,next);
                        }
                    ],function(err,results){
                        if(err){
                            callback(err,null);
                        }
                        callback(null,results);
                    })
                }
            },function(err,results){
                if(err){
                    next(err,null);
                }
                next(null,results);
            });
        },
    ],function (err, results) {
        if (err) {
            logger.error(err);
            return;
        } else {
            logger.info("EC2 Data Successfully Added for Provider "+provider.providerName);
            return;
        }
    });
};

function saveEC2Data(ec2Info,provider, callback){
    var count = 0;
    if(ec2Info.length === 0) {
        return callback(null, ec2Info);
    };
    for(var i = 0; i < ec2Info.length; i++) {
        (function(ec2) {
            instancesDao.getInstancesByProviderIdOrgIdAndPlatformId(ec2.orgId,ec2.providerId,ec2.platformId,function(err,managedInstances) {
                if (err) {
                    logger.error(err);
                    count++;
                    return;
                }else if (managedInstances.length > 0) {
                    instanceService.instanceSyncWithAWS(managedInstances[0]._id,ec2,provider, function(err, updateInstanceData) {
                        if (err) {
                            logger.error(err);
                            count++;
                            return;
                        } else {
                            count++;
                            if(count === ec2Info.length){
                                callback(null,ec2Info);
                            }
                        }
                    });
                }else {
                    assignedInstancesDao.getInstancesByProviderIdOrgIdAndPlatformId(ec2.orgId,ec2.providerId,ec2.platformId,function(err,assignedInstances) {
                        if (err) {
                            logger.error(err);
                            count++;
                            return;
                        }else if (assignedInstances.length > 0) {
                            assignedInstancesDao.updateInstanceStatus(assignedInstances[0]._id,ec2, function(err, updateInstanceData) {
                                if (err) {
                                    logger.error(err);
                                    count++;
                                    return;
                                } else {
                                    count++;
                                    if(count === ec2Info.length){
                                        callback(null,ec2Info);
                                    }
                                }
                            });
                        }else {
                            unassignedInstancesModel.getInstancesByProviderIdOrgIdAndPlatformId(ec2.orgId, ec2.providerId, ec2.platformId, function (err, unassignedInstances) {
                                if (err) {
                                    logger.error(err);
                                    count++;
                                    return;
                                }else if (unassignedInstances.length === 0) {
                                    unassignedInstancesModel.createNew(ec2, function (err, saveUnassignedInstance) {
                                        if (err) {
                                            logger.error(err);
                                            count++;
                                            return;
                                        } else {
                                            count++;
                                            if(count === ec2Info.length){
                                                callback(null,ec2Info);
                                            }
                                        }
                                    });
                                }else {
                                    unassignedInstancesModel.updateInstanceStatus(unassignedInstances[0]._id,ec2, function (err, updateInstanceData) {
                                        if (err) {
                                            logger.error(err);
                                            count++;
                                            return;
                                        } else {
                                            count++;
                                            if(count === ec2Info.length){
                                                callback(null,ec2Info);
                                            }
                                        }
                                    });
                                }
                            })
                        }
                    });
                }
            });
        })(ec2Info[i]);
    };
};
function tagMappingForInstances(instances,provider,next){
    tagsModel.getTagsByProviderId(provider._id, function (err, tagDetails) {
        if (err) {
            logger.error("Unable to get tags", err);
            next(err);
        }
        var projectTag = null;
        var environmentTag = null;
        var bgTag = null;
        if(tagDetails.length > 0) {
            for (var i = 0; i < tagDetails.length; i++) {
                if (('catalystEntityType' in tagDetails[i]) && tagDetails[i].catalystEntityType == 'project') {
                    projectTag = tagDetails[i];
                }else if (('catalystEntityType' in tagDetails[i]) && tagDetails[i].catalystEntityType == 'environment') {
                    environmentTag = tagDetails[i];
                }else if (('catalystEntityType' in tagDetails[i]) && tagDetails[i].catalystEntityType == 'bgName') {
                    bgTag = tagDetails[i];
                }
            }
        }else{
            next(null,tagDetails);
        }
        var count = 0;
        var assignedInstanceList = [];
        if(instances.length > 0) {
            for (var i = 0; i < instances.length; i++) {
                (function(instance) {
                    var catalystProjectId = null;
                    var catalystProjectName = null;
                    var catalystEnvironmentId = null;
                    var catalystEnvironmentName = null;
                    var catalystBgId = null;
                    var catalystBgName = null;
                    var assignmentFound = false;
                    if(instance.tags) {
                        if ((bgTag !== null || projectTag !== null || environmentTag !== null) && (instance.isDeleted === false)){
                            if(bgTag !== null && bgTag.name in instance.tags) {
                                for (var y = 0; y < bgTag.catalystEntityMapping.length; y++) {
                                    if (bgTag.catalystEntityMapping[y].tagValue !== '' && instance.tags[bgTag.name] !== ''
                                        && bgTag.catalystEntityMapping[y].tagValue === instance.tags[bgTag.name]) {
                                        catalystBgId = bgTag.catalystEntityMapping[y].catalystEntityId;
                                        catalystBgName = bgTag.catalystEntityMapping[y].catalystEntityName;
                                        break;
                                    }
                                }
                            }
                            if(projectTag !== null && projectTag.name in instance.tags) {
                                for (var y = 0; y < projectTag.catalystEntityMapping.length; y++) {
                                    if (projectTag.catalystEntityMapping[y].tagValue !== '' && instance.tags[projectTag.name] !== '' &&
                                        projectTag.catalystEntityMapping[y].tagValue === instance.tags[projectTag.name]) {
                                        catalystProjectId = projectTag.catalystEntityMapping[y].catalystEntityId;
                                        catalystProjectName = projectTag.catalystEntityMapping[y].catalystEntityName;
                                        break;
                                    }
                                }
                            }
                            if(environmentTag !== null && environmentTag.name in instance.tags) {
                                for (var y = 0; y < environmentTag.catalystEntityMapping.length; y++) {
                                    if (environmentTag.catalystEntityMapping[y].tagValue !== '' && instance.tags[environmentTag.name] !== '' &&
                                        environmentTag.catalystEntityMapping[y].tagValue === instance.tags[environmentTag.name]) {
                                        catalystEnvironmentId = environmentTag.catalystEntityMapping[y].catalystEntityId;
                                        catalystEnvironmentName = environmentTag.catalystEntityMapping[y].catalystEntityName;
                                        break;
                                    }
                                }
                            }
                            if (catalystBgId !== null || catalystProjectId !== null || catalystEnvironmentId !== null) {
                                assignmentFound = true;
                            }
                            if (assignmentFound === true) {
                                unassignedInstancesModel.removeInstanceById(instance._id, function (err, data) {
                                    if (err) {
                                        logger.error(err);
                                        count++;
                                        return;
                                    } else {
                                        var assignedInstanceObj = {
                                            orgId: instance.orgId,
                                            orgName: instance.orgName,
                                            bgId: catalystBgId,
                                            bgName: catalystBgName,
                                            projectId: catalystProjectId,
                                            projectName: catalystProjectName,
                                            environmentId: catalystEnvironmentId,
                                            environmentName: catalystEnvironmentName,
                                            providerId: instance.providerId,
                                            providerType: instance.providerType,
                                            providerData: instance.providerData,
                                            platformId: instance.platformId,
                                            ip: instance.ip,
                                            os: instance.os,
                                            state: instance.state,
                                            subnetId: instance.subnetId,
                                            vpcId: instance.vpcId,
                                            privateIpAddress: instance.privateIpAddress,
                                            hostName:instance.hostName,
                                            tags: instance.tags,
                                        }
                                        assignedInstanceList.push(assignedInstanceObj);
                                        assignedInstanceObj = {};
                                        count++;
                                        if (count === instances.length) {
                                            next(null, assignedInstanceList);
                                        } else {
                                            return;
                                        }
                                    }
                                })
                            } else {
                                count++;
                                if (count === instances.length) {
                                    next(null, assignedInstanceList);
                                }
                            }
                        }else {
                            count++;
                            if (count === instances.length) {
                                next(null, assignedInstanceList);
                            }
                        }
                    }else{
                        count++;
                        if (count === instances.length) {
                            next(null, assignedInstanceList);
                        }
                    }
                })(instances[i]);
            }
        }else{
            logger.info("Please configure Instances for Tag Mapping");
            next(null,instances);
        }
    });
}

function saveAssignedInstances(assignedInstances,callback){
    if(assignedInstances.length > 0){
        var results=[];
        for(var i = 0; i < assignedInstances.length; i++){
            (function(assignedInstance){
                assignedInstancesDao.createNew(assignedInstance,function(err,data){
                    if(err){
                        logger.error(err);
                        results.push(err);
                        return;
                    }else{
                        results.push(data);
                        if(results.length === assignedInstances.length){
                            callback(null,assignedInstances);
                        }
                    }
                })
            })(assignedInstances[i]);
        }
    }else{
        callback(null,assignedInstances);
    }
}

function instanceSyncWithAWS(ec2Instances,providerId,callback){
    if(ec2Instances.length > 0){
        var ec2InstanceIds = [];
        for(var i = 0;i < ec2Instances.length;i++){
            ec2InstanceIds.push(ec2Instances[i].platformId);
        }
        if(ec2InstanceIds.length === ec2Instances.length){
            async.parallel({
                instance:function(callback){
                    instancesDao.getInstanceByProviderId(providerId,function(err,instances){
                        if(err){
                            callback(err,null);
                        }else if(instances.length > 0){
                            var instanceCount = 0;
                            for(var j = 0;j < instances.length;j++){
                                (function(instance){
                                   if(ec2InstanceIds.indexOf(instance.platformId) !== -1){
                                       instanceCount++;
                                       if(instanceCount === instances.length){
                                           callback(null,instances);
                                           return;
                                       }
                                   }else{
                                       instancesDao.removeTerminatedInstanceById(instance._id,function(err,data){
                                           if(err){
                                               instanceCount++;
                                               logger.error(err);
                                               return;
                                           }
                                           instanceCount++;
                                           var timestampStarted = new Date().getTime();
                                           var user = instance.catUser ? instance.catUser : 'superadmin';
                                           var actionLog = instancesDao.insertInstanceStatusActionLog(instance._id, user,'terminated', timestampStarted);
                                           var logReferenceIds = [instance._id, actionLog._id];
                                           logsDao.insertLog({
                                               referenceId: logReferenceIds,
                                               err: false,
                                               log: "Instance : terminated",
                                               timestamp: timestampStarted
                                           });
                                           var instanceLog = {
                                               actionId: actionLog._id,
                                               instanceId: instance._id,
                                               orgName: instance.orgName,
                                               bgName: instance.bgName,
                                               projectName: instance.projectName,
                                               envName: instance.environmentName,
                                               status: 'terminated',
                                               actionStatus: "success",
                                               platformId: instance.platformId,
                                               blueprintName: instance.blueprintData.blueprintName,
                                               data: instance.runlist,
                                               platform: instance.hardware.platform,
                                               os: instance.hardware.os,
                                               size: instance.instanceType,
                                               user: user,
                                               createdOn: new Date().getTime(),
                                               startedOn: new Date().getTime(),
                                               providerType: instance.providerType,
                                               action: 'Terminated',
                                               logs: []
                                           };
                                           instanceLogModel.createOrUpdate(actionLog._id, instance._id, instanceLog, function(err, logData) {
                                               if (err) {
                                                   logger.error("Failed to create or update instanceLog: ", err);
                                               }
                                           });
                                           if(instanceCount === instances.length){
                                               callback(null,instances);
                                               return;
                                           }
                                       })
                                   }
                                    
                                })(instances[j]);
                            }
                        }else{
                            callback(null,instances);
                        }
                    });
                },
                assignedInstance:function(callback){
                    assignedInstancesDao.getInstanceByProviderId(providerId,function(err,assignedInstances){
                        if(err){
                            callback(err,null);
                        }else if(assignedInstances.length > 0){
                            var assignedInstanceCount = 0;
                            for(var k = 0;k < assignedInstances.length;k++){
                                (function(assignedInstance){
                                    if(ec2InstanceIds.indexOf(assignedInstance.platformId) !== -1){
                                        assignedInstanceCount++;
                                        if(assignedInstanceCount === assignedInstances.length){
                                            callback(null,assignedInstances);
                                            return;
                                        }
                                    }else{
                                        assignedInstancesDao.removeInstanceById(assignedInstance._id,function(err,data){
                                            if(err){
                                                assignedInstanceCount++;
                                                logger.error(err);
                                                return;
                                            }
                                            assignedInstanceCount++;
                                            if(assignedInstanceCount === assignedInstances.length){
                                                callback(null,assignedInstances);
                                                return;
                                            }
                                        })
                                    }

                                })(assignedInstances[k]);
                            }
                        }else{
                            callback(null,assignedInstances);
                        }
                    });
                },
                unassignedInstance:function(callback){
                    unassignedInstancesModel.getUnAssignedInstancesByProviderId(providerId,function(err,unAssignedInstances){
                        if(err){
                            callback(err,null);
                        }else if(unAssignedInstances.length > 0){
                            var unAssignedInstanceCount = 0;
                            for(var l = 0;l < unAssignedInstances.length;l++){
                                (function(unAssignedInstance){
                                    if(ec2InstanceIds.indexOf(unAssignedInstance.platformId) !== -1){
                                        unAssignedInstanceCount++;
                                        if(unAssignedInstanceCount === unAssignedInstances.length){
                                            callback(null,unAssignedInstances);
                                            return;
                                        }
                                    }else{
                                        unassignedInstancesModel.removeTerminatedInstanceById(unAssignedInstance._id,function(err,data){
                                            if(err){
                                                unAssignedInstanceCount++;
                                                logger.error(err);
                                                return;
                                            }
                                            unAssignedInstanceCount++;
                                            if(unAssignedInstanceCount === unAssignedInstances.length){
                                                callback(null,unAssignedInstances);
                                                return;
                                            }
                                        })
                                    }

                                })(unAssignedInstances[l]);
                            }
                        }else{
                            callback(null,unAssignedInstances);
                        }
                    });
                }
            },function(err,results){
                if(err){
                    callback(err,null);
                }
                callback(null,results);
            })
        }
    }else{
        callback(null,ec2Instances);
    }

}
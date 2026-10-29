module.exports=({config})=>({...config,ios:{...config.ios,buildNumber:process.env.GITHUB_RUN_NUMBER||config.ios.buildNumber}});

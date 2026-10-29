import {ActionSheetIOS,Alert,Platform} from 'react-native';
export function confirm(title:string,message:string,action:()=>void){
 if(Platform.OS==='web'){if(globalThis.confirm(title+'\n'+message))action();}
 else Alert.alert(title,message,[{text:'Отмена',style:'cancel'},{text:'Продолжить',onPress:action}]);
}
export function choose(options:string[],onSelect:(index:number)=>void,title?:string,destructiveButtonIndex?:number){
 if(Platform.OS==='web'){const n=globalThis.prompt((title||'Выберите действие')+'\n'+options.map((x,i)=>`${i+1}. ${x}`).join('\n'));if(n!==null){const i=Number(n)-1;if(Number.isInteger(i)&&i>=0&&i<options.length-1)onSelect(i);}return;}
 ActionSheetIOS.showActionSheetWithOptions({title,options,cancelButtonIndex:options.length-1,destructiveButtonIndex},onSelect);
}

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_REMAP_MODULE(
    ElasticOtelReactNative,
    ElasticOtelReactNativeModule,
    NSObject)

RCT_EXTERN_METHOD(getStatus
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startSpan
                  : (NSString *)name parentSpanHandle
                  : (NSString * _Nullable)parentSpanHandle resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(endSpan
                  : (NSString *)handle resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(emitLog
                  : (NSString *)body severity
                  : (NSString *)severity spanHandle
                  : (NSString * _Nullable)spanHandle resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(recordWidgetClick
                  : (NSString *)widgetId widgetName
                  : (NSString * _Nullable)widgetName timestamp
                  : (double)timestamp resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

@end

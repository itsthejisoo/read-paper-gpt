#import "DataStore.h"
#import <objc/message.h>
#include <stdio.h>
#include <unistd.h>

// 프로브 빌드만 -D로 이름을 바꿔 SPI가 없는 환경의 대체 경로를 시험한다.
#ifndef RPT_SPI_CONFIGURATION_CLASS
#define RPT_SPI_CONFIGURATION_CLASS "_WKWebsiteDataStoreConfiguration"
#endif
#ifndef RPT_SPI_INIT_WITH_DIRECTORY
#define RPT_SPI_INIT_WITH_DIRECTORY "initWithDirectory:"
#endif
#ifndef RPT_SPI_INIT_WITH_CONFIGURATION
#define RPT_SPI_INIT_WITH_CONFIGURATION "_initWithConfiguration:"
#endif

typedef id (*RPTInitWithObject)(__attribute__((ns_consumed)) id, SEL, id) __attribute__((ns_returns_retained));
typedef void (*RPTSetObject)(id, SEL, id);
typedef BOOL (*RPTGetBool)(id, SEL);

typedef struct {
    const char *setter;
    const char *component;
    BOOL isFile;
} RPTStorageLocation;

static const RPTStorageLocation kStorageLocations[] = {
    {"setGeneralStorageDirectory:", "Default", NO},
    {"_setWebStorageDirectory:", "LocalStorage", NO},
    {"_setIndexedDBDatabaseDirectory:", "IndexedDB", NO},
    {"_setWebSQLDatabaseDirectory:", "WebSQL", NO},
    {"_setCookieStorageFile:", "Cookies/Cookies.binarycookies", YES},
    {"setNetworkCacheDirectory:", "NetworkCache", NO},
    {"setHSTSStorageDirectory:", "HSTS", NO},
    {"_setCacheStorageDirectory:", "CacheStorage", NO},
    {"_setServiceWorkerRegistrationDirectory:", "ServiceWorkers", NO},
    {"_setResourceLoadStatisticsDirectory:", "ResourceLoadStatistics", NO},
    {"_setResourceMonitorThrottlerDirectory:", "ResourceMonitorThrottler", NO},
    {"setDeviceIdHashSaltsStorageDirectory:", "DeviceIdHashSalts", NO},
    {"setMediaCacheDirectory:", "MediaCache", NO},
    {"setMediaKeysStorageDirectory:", "MediaKeys", NO},
    {"setAlternativeServicesStorageDirectory:", "AlternativeServices", NO},
    {"setApplicationCacheDirectory:", "OfflineWebApplicationCache", NO},
};

static WKWebsiteDataStore *RPTFail(NSString *reason) {
    fprintf(stderr, "RPTMakeDataStore: %s\n", reason.UTF8String);
    return nil;
}

static BOOL RPTIsWritableDirectory(NSURL *url) {
    BOOL isDirectory = NO;
    return url.isFileURL
        && [NSFileManager.defaultManager fileExistsAtPath:url.path isDirectory:&isDirectory]
        && isDirectory
        && access(url.fileSystemRepresentation, W_OK | X_OK) == 0;
}

static WKWebsiteDataStore *RPTMakeDataStoreUnguarded(NSURL *root) {
    if (!NSThread.isMainThread) return RPTFail(@"메인 스레드에서 호출해야 합니다");
    if (!RPTIsWritableDirectory(root)) return RPTFail(@"데이터 폴더가 없거나 쓸 수 없습니다");

    Class configurationClass = NSClassFromString(@RPT_SPI_CONFIGURATION_CLASS);
    if (!configurationClass) return RPTFail(@"WebKit에 " RPT_SPI_CONFIGURATION_CLASS " 클래스가 없습니다");
    SEL storeInit = sel_registerName(RPT_SPI_INIT_WITH_CONFIGURATION);
    if (![WKWebsiteDataStore instancesRespondToSelector:storeInit])
        return RPTFail(@"WebKit에 -[WKWebsiteDataStore " RPT_SPI_INIT_WITH_CONFIGURATION "]가 없습니다");

    // -init은 ~/Library의 기본 경로로 초기화한 뒤 아래 설정으로 덮어쓰므로 initWithDirectory:를 먼저 쓴다.
    SEL directoryInit = sel_registerName(RPT_SPI_INIT_WITH_DIRECTORY);
    id configuration = [configurationClass instancesRespondToSelector:directoryInit]
        ? ((RPTInitWithObject)objc_msgSend)([configurationClass alloc], directoryInit, root)
        : [[configurationClass alloc] init];
    if (!configuration) return RPTFail(@"저장소 설정을 만들지 못했습니다");

    for (size_t i = 0; i < sizeof(kStorageLocations) / sizeof(kStorageLocations[0]); i++) {
        SEL setter = sel_registerName(kStorageLocations[i].setter);
        if (![configuration respondsToSelector:setter]) continue;
        NSURL *url = [root URLByAppendingPathComponent:@(kStorageLocations[i].component) isDirectory:!kStorageLocations[i].isFile];
        ((RPTSetObject)objc_msgSend)(configuration, setter, url);
    }

    SEL isPersistent = @selector(isPersistent);
    if (![configuration respondsToSelector:isPersistent] || !((RPTGetBool)objc_msgSend)(configuration, isPersistent))
        return RPTFail(@"저장소 설정이 영구 저장소가 아닙니다");

    WKWebsiteDataStore *store = ((RPTInitWithObject)objc_msgSend)([WKWebsiteDataStore alloc], storeInit, configuration);
    if (!store.isPersistent) return RPTFail(@"영구 저장소를 만들지 못했습니다");
    return store;
}

WKWebsiteDataStore *RPTMakeDataStore(NSURL *root) {
    @try {
        return RPTMakeDataStoreUnguarded(root);
    } @catch (NSException *exception) {
        return RPTFail([NSString stringWithFormat:@"WebKit 예외 %@: %@", exception.name, exception.reason]);
    }
}

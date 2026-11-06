#import <WebKit/WebKit.h>

// Persistent website data store under root; nil if the WebKit SPI is unavailable.
FOUNDATION_EXTERN WKWebsiteDataStore * _Nullable RPTMakeDataStore(NSURL * _Nonnull root);

package co.elastic.otel.reactnative.fixture

import android.app.Application
import co.elastic.otel.reactnative.BootstrapConfiguration
import co.elastic.otel.reactnative.ElasticOtelReactNative
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {
    override val reactHost: ReactHost by lazy {
        getDefaultReactHost(
            context = applicationContext,
            packageList = PackageList(this).packages,
        )
    }

    override fun onCreate() {
        super.onCreate()
        ElasticOtelReactNative.initialize(
            this,
            BootstrapConfiguration(
                exportUrl = "http://10.0.2.2:4318",
                serviceName = "edot-react-native-fixture",
                instrumentationScopeName = "co.elastic.otel.reactnative.fixture",
            ),
        )
        loadReactNative(this)
    }
}

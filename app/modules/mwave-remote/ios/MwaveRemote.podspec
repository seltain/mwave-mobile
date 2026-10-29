# Модуль mwave: кнопки «следующая» и «предыдущая» на экране блокировки, в Пункте управления и в наушниках.
# (В expo-audio есть только пауза и перемотка.)
Pod::Spec.new do |s|
  s.name           = 'MwaveRemote'
  s.version        = '1.0.0'
  s.summary        = 'mwave: next/previous track remote commands'
  s.description    = 'Next and previous track commands from the lock screen, Control Center and headphones.'
  s.author         = 'mwave'
  s.homepage       = 'https://github.com/seltain/mwave-mobile'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.swift'
end

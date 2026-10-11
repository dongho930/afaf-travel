// 앱에서 쓰는 Phosphor 아이콘을 여기 한 곳에서만 불러옵니다.
//
// "phosphor-react-native"에서 바로 불러오면 Metro 번들러가 안 쓰는 아이콘을
// 걸러내지 못해서, 1,500여 개 아이콘의 굵기 6종이 전부 번들에 들어갑니다(웹 번들
// 9.6MB 중 소스 기준 5.7MB). 아이콘별 파일(src/icons/*)을 하나씩 불러오면 실제로
// 쓰는 아이콘만 들어갑니다 — 패키지 README가 안내하는 방식입니다.
//
// 새 아이콘이 필요하면 아래에 한 줄 추가하고, 화면에서는 이 파일에서 불러오세요.
// 화면 코드에서 "phosphor-react-native"를 직접 불러오면 다시 전체가 들어갑니다.
export type { Icon, IconProps, IconWeight } from "phosphor-react-native";

export { AirplaneIcon } from "phosphor-react-native/src/icons/Airplane";
export { ArmchairIcon } from "phosphor-react-native/src/icons/Armchair";
export { ArrowsClockwiseIcon } from "phosphor-react-native/src/icons/ArrowsClockwise";
export { BabyCarriageIcon } from "phosphor-react-native/src/icons/BabyCarriage";
export { BabyIcon } from "phosphor-react-native/src/icons/Baby";
export { BedIcon } from "phosphor-react-native/src/icons/Bed";
export { BellRingingIcon } from "phosphor-react-native/src/icons/BellRinging";
export { BookOpenTextIcon } from "phosphor-react-native/src/icons/BookOpenText";
export { BusIcon } from "phosphor-react-native/src/icons/Bus";
export { CalendarBlankIcon } from "phosphor-react-native/src/icons/CalendarBlank";
export { CameraIcon } from "phosphor-react-native/src/icons/Camera";
export { CarIcon } from "phosphor-react-native/src/icons/Car";
export { CaretDownIcon } from "phosphor-react-native/src/icons/CaretDown";
export { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
export { CaretRightIcon } from "phosphor-react-native/src/icons/CaretRight";
export { CaretUpIcon } from "phosphor-react-native/src/icons/CaretUp";
export { ChatCircleTextIcon } from "phosphor-react-native/src/icons/ChatCircleText";
export { CheckCircleIcon } from "phosphor-react-native/src/icons/CheckCircle";
export { CheckIcon } from "phosphor-react-native/src/icons/Check";
export { ClockCounterClockwiseIcon } from "phosphor-react-native/src/icons/ClockCounterClockwise";
export { ClockIcon } from "phosphor-react-native/src/icons/Clock";
export { ClosedCaptioningIcon } from "phosphor-react-native/src/icons/ClosedCaptioning";
export { CouchIcon } from "phosphor-react-native/src/icons/Couch";
export { DogIcon } from "phosphor-react-native/src/icons/Dog";
export { DoorOpenIcon } from "phosphor-react-native/src/icons/DoorOpen";
export { DotsSixVerticalIcon } from "phosphor-react-native/src/icons/DotsSixVertical";
export { EarIcon } from "phosphor-react-native/src/icons/Ear";
export { ElevatorIcon } from "phosphor-react-native/src/icons/Elevator";
export { EnvelopeSimpleIcon } from "phosphor-react-native/src/icons/EnvelopeSimple";
export { EyeIcon } from "phosphor-react-native/src/icons/Eye";
export { FileTextIcon } from "phosphor-react-native/src/icons/FileText";
export { FirstAidKitIcon } from "phosphor-react-native/src/icons/FirstAidKit";
export { FloppyDiskIcon } from "phosphor-react-native/src/icons/FloppyDisk";
export { ForkKnifeIcon } from "phosphor-react-native/src/icons/ForkKnife";
export { GearIcon } from "phosphor-react-native/src/icons/Gear";
export { HandTapIcon } from "phosphor-react-native/src/icons/HandTap";
export { HandWavingIcon } from "phosphor-react-native/src/icons/HandWaving";
export { HeartIcon } from "phosphor-react-native/src/icons/Heart";
export { ImageSquareIcon } from "phosphor-react-native/src/icons/ImageSquare";
export { InfoIcon } from "phosphor-react-native/src/icons/Info";
export { ListBulletsIcon } from "phosphor-react-native/src/icons/ListBullets";
export { LockIcon } from "phosphor-react-native/src/icons/Lock";
export { MagnifyingGlassIcon } from "phosphor-react-native/src/icons/MagnifyingGlass";
export { MapPinIcon } from "phosphor-react-native/src/icons/MapPin";
export { MapTrifoldIcon } from "phosphor-react-native/src/icons/MapTrifold";
export { MicrophoneIcon } from "phosphor-react-native/src/icons/Microphone";
export { MoonIcon } from "phosphor-react-native/src/icons/Moon";
export { NavigationArrowIcon } from "phosphor-react-native/src/icons/NavigationArrow";
export { NotePencilIcon } from "phosphor-react-native/src/icons/NotePencil";
export { NotebookIcon } from "phosphor-react-native/src/icons/Notebook";
export { ParkIcon } from "phosphor-react-native/src/icons/Park";
export { PathIcon } from "phosphor-react-native/src/icons/Path";
export { PencilSimpleIcon } from "phosphor-react-native/src/icons/PencilSimple";
export { PersonSimpleWalkIcon } from "phosphor-react-native/src/icons/PersonSimpleWalk";
export { PlusIcon } from "phosphor-react-native/src/icons/Plus";
export { QuestionIcon } from "phosphor-react-native/src/icons/Question";
export { SeatIcon } from "phosphor-react-native/src/icons/Seat";
export { SignOutIcon } from "phosphor-react-native/src/icons/SignOut";
export { SignpostIcon } from "phosphor-react-native/src/icons/Signpost";
export { SmileyIcon } from "phosphor-react-native/src/icons/Smiley";
export { SparkleIcon } from "phosphor-react-native/src/icons/Sparkle";
export { SpeakerHighIcon } from "phosphor-react-native/src/icons/SpeakerHigh";
export { StarHalfIcon } from "phosphor-react-native/src/icons/StarHalf";
export { StarIcon } from "phosphor-react-native/src/icons/Star";
export { StopCircleIcon } from "phosphor-react-native/src/icons/StopCircle";
export { SuitcaseIcon } from "phosphor-react-native/src/icons/Suitcase";
export { SunIcon } from "phosphor-react-native/src/icons/Sun";
export { TextAaIcon } from "phosphor-react-native/src/icons/TextAa";
export { ToiletIcon } from "phosphor-react-native/src/icons/Toilet";
export { TrainIcon } from "phosphor-react-native/src/icons/Train";
export { TrashIcon } from "phosphor-react-native/src/icons/Trash";
export { UserIcon } from "phosphor-react-native/src/icons/User";
export { UsersIcon } from "phosphor-react-native/src/icons/Users";
export { UsersThreeIcon } from "phosphor-react-native/src/icons/UsersThree";
export { WarningCircleIcon } from "phosphor-react-native/src/icons/WarningCircle";
export { WarningIcon } from "phosphor-react-native/src/icons/Warning";
export { WheelchairIcon } from "phosphor-react-native/src/icons/Wheelchair";
export { WifiSlashIcon } from "phosphor-react-native/src/icons/WifiSlash";
export { XCircleIcon } from "phosphor-react-native/src/icons/XCircle";
export { XIcon } from "phosphor-react-native/src/icons/X";
